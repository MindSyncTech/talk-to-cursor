#!/usr/bin/env python3
"""Report macOS permissions for the Python app running the background helper."""

import json
import os
import sys
import threading
import time
from pathlib import Path


def permission_target():
    executable = Path(os.path.realpath(sys.executable))
    version_dir = executable.parent.parent
    python_app = version_dir / "Resources" / "Python.app"
    return str(python_app if python_app.is_dir() else executable)


def microphone_status(request=False):
    try:
        from AVFoundation import AVCaptureDevice, AVMediaTypeAudio

        status = int(
            AVCaptureDevice.authorizationStatusForMediaType_(AVMediaTypeAudio)
        )
        if request and status == 0:
            completed = threading.Event()

            def handle_result(_granted):
                completed.set()

            AVCaptureDevice.requestAccessForMediaType_completionHandler_(
                AVMediaTypeAudio,
                handle_result,
            )
            completed.wait(timeout=30)
            status = int(
                AVCaptureDevice.authorizationStatusForMediaType_(AVMediaTypeAudio)
            )
        return {
            0: "not_determined",
            1: "restricted",
            2: "denied",
            3: "granted",
        }.get(status, "unknown")
    except Exception:
        return "unavailable"


def main():
    from ApplicationServices import (
        AXIsProcessTrusted,
        AXIsProcessTrustedWithOptions,
        kAXTrustedCheckOptionPrompt,
    )
    from Quartz import (
        CGPreflightListenEventAccess,
        CGRequestListenEventAccess,
    )

    request = "--request" in sys.argv[1:]
    if request and not AXIsProcessTrusted():
        AXIsProcessTrustedWithOptions({kAXTrustedCheckOptionPrompt: True})
    if request and not CGPreflightListenEventAccess():
        CGRequestListenEventAccess()
    if request:
        time.sleep(0.25)

    print(
        json.dumps(
            {
                "accessibility": (
                    "granted" if AXIsProcessTrusted() else "denied"
                ),
                "inputMonitoring": (
                    "granted"
                    if CGPreflightListenEventAccess()
                    else "denied"
                ),
                "microphone": microphone_status(request=request),
                "applicationPath": permission_target(),
            }
        )
    )


if __name__ == "__main__":
    main()
