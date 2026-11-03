"""Newline-delimited JSON IPC between the Background Helper and local clients.

Clients such as the MCP server connect to a Unix socket in
the private user-data directory. Messages are single-line JSON objects with a
``type`` field. The helper can broadcast to every client or reply to one.
"""

import json
import os
import socket
import stat
import threading
from pathlib import Path

MAX_MESSAGE_BYTES = 4 * 1024 * 1024


class IpcClient:
    def __init__(self, connection):
        self.connection = connection
        self.role = "unknown"
        self._send_lock = threading.Lock()

    def send(self, message):
        payload = (json.dumps(message, separators=(",", ":")) + "\n").encode("utf-8")
        with self._send_lock:
            try:
                self.connection.sendall(payload)
                return True
            except OSError:
                return False

    def close(self):
        try:
            self.connection.close()
        except OSError:
            pass


class HelperIpcServer:
    """Accept local clients and dispatch each message to ``on_message``."""

    def __init__(self, socket_path, on_message, on_connect=None):
        self.socket_path = Path(socket_path)
        self.on_message = on_message
        self.on_connect = on_connect
        self._clients = set()
        self._clients_lock = threading.Lock()
        self._server = None

    def start(self):
        self._remove_stale_socket()
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        previous_umask = os.umask(0o177)
        try:
            server.bind(str(self.socket_path))
        finally:
            os.umask(previous_umask)
        os.chmod(self.socket_path, 0o600)
        server.listen(8)
        self._server = server
        threading.Thread(target=self._accept_loop, daemon=True).start()
        print(f"[ipc] Listening on {self.socket_path}")

    def stop(self):
        with self._clients_lock:
            clients = list(self._clients)
            self._clients.clear()
        for client in clients:
            client.close()
        if self._server is not None:
            try:
                self._server.close()
            except OSError:
                pass
        try:
            self.socket_path.unlink()
        except OSError:
            pass

    def broadcast(self, message, role=None):
        with self._clients_lock:
            clients = list(self._clients)
        delivered = 0
        for client in clients:
            if role is not None and client.role != role:
                continue
            if client.send(message):
                delivered += 1
        return delivered

    def has_client(self, role):
        with self._clients_lock:
            return any(client.role == role for client in self._clients)

    def _remove_stale_socket(self):
        try:
            mode = os.lstat(self.socket_path).st_mode
        except FileNotFoundError:
            return
        if not stat.S_ISSOCK(mode):
            raise RuntimeError(f"{self.socket_path} exists and is not a socket")
        probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            probe.connect(str(self.socket_path))
        except OSError:
            self.socket_path.unlink()
            return
        finally:
            probe.close()
        raise RuntimeError("Another Background Helper is already running")

    def _accept_loop(self):
        while True:
            try:
                connection, _ = self._server.accept()
            except OSError:
                return
            client = IpcClient(connection)
            with self._clients_lock:
                self._clients.add(client)
            threading.Thread(
                target=self._client_loop,
                args=(client,),
                daemon=True,
            ).start()

    def _client_loop(self, client):
        buffer = b""
        try:
            if self.on_connect is not None:
                self.on_connect(client)
            while True:
                chunk = client.connection.recv(65536)
                if not chunk:
                    return
                buffer += chunk
                if len(buffer) > MAX_MESSAGE_BYTES:
                    print("[ipc] Dropping client that exceeded the message size limit")
                    return
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    if not line.strip():
                        continue
                    try:
                        message = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(message, dict) or "type" not in message:
                        continue
                    if message["type"] == "hello":
                        client.role = str(message.get("role", "unknown"))
                    try:
                        self.on_message(client, message)
                    except Exception as error:
                        print(f"[ipc] Handler failed for {message['type']}: {error}")
        except OSError:
            return
        finally:
            with self._clients_lock:
                self._clients.discard(client)
            client.close()
