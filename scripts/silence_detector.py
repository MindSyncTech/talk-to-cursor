#!/usr/bin/env python3
"""
Silence Detector Module

Monitors microphone input and detects when the user has stopped speaking
based on RMS (root mean square) amplitude analysis.

State machine:
  IDLE -> SPEECH (RMS exceeds threshold)
  SPEECH -> TRAILING_SILENCE (RMS drops below threshold)
  TRAILING_SILENCE -> SPEECH (RMS exceeds threshold again)
  TRAILING_SILENCE -> DONE (silence duration exceeded)
"""

import numpy as np
import sounddevice as sd
import time
from enum import Enum

class State(Enum):
    IDLE = "idle"
    SPEECH = "speech"
    TRAILING_SILENCE = "trailing_silence"
    DONE = "done"

class SilenceDetector:
    def __init__(self, 
                 silence_threshold=0.02,
                 silence_duration=2.0,
                 sample_rate=16000,
                 chunk_size=1024):
        """
        Initialize the silence detector.
        
        Args:
            silence_threshold: RMS amplitude threshold for speech detection
            silence_duration: Seconds of silence needed to confirm user stopped
            sample_rate: Audio sample rate in Hz
            chunk_size: Number of samples per chunk
        """
        self.silence_threshold = silence_threshold
        self.silence_duration = silence_duration
        self.sample_rate = sample_rate
        self.chunk_size = chunk_size
        
        self.state = State.IDLE
        self.silence_start_time = None
        self.speech_detected = False
        
    def compute_rms(self, audio_chunk):
        """Compute the RMS (root mean square) of an audio chunk."""
        return np.sqrt(np.mean(audio_chunk ** 2))
    
    def wait_for_silence(self, verbose=True):
        """
        Monitor the microphone and wait for silence after detecting speech.
        
        Returns when the user has stopped speaking (silence_duration exceeded).
        """
        if verbose:
            print(f"[silence-detector] Listening for speech...")
            print(f"[silence-detector] Threshold: {self.silence_threshold:.4f}, Silence duration: {self.silence_duration}s")
        
        # Open the microphone stream
        with sd.InputStream(samplerate=self.sample_rate, 
                           channels=1, 
                           blocksize=self.chunk_size) as stream:
            
            while self.state != State.DONE:
                # Read audio chunk
                audio_data, overflowed = stream.read(self.chunk_size)
                
                if overflowed:
                    print("[silence-detector] Warning: Audio buffer overflow")
                
                # Compute RMS amplitude
                rms = self.compute_rms(audio_data.flatten())
                
                # State machine transitions
                if self.state == State.IDLE:
                    if rms > self.silence_threshold:
                        self.state = State.SPEECH
                        self.speech_detected = True
                        if verbose:
                            print(f"[silence-detector] Speech detected (RMS: {rms:.4f})")
                
                elif self.state == State.SPEECH:
                    if rms < self.silence_threshold:
                        self.state = State.TRAILING_SILENCE
                        self.silence_start_time = time.time()
                        if verbose:
                            print(f"[silence-detector] Trailing silence started...")
                    # else: still speaking, remain in SPEECH state
                
                elif self.state == State.TRAILING_SILENCE:
                    if rms > self.silence_threshold:
                        # User started speaking again
                        self.state = State.SPEECH
                        self.silence_start_time = None
                        if verbose:
                            print(f"[silence-detector] Speech resumed (RMS: {rms:.4f})")
                    else:
                        # Check if silence duration exceeded
                        elapsed = time.time() - self.silence_start_time
                        if elapsed >= self.silence_duration:
                            self.state = State.DONE
                            if verbose:
                                print(f"[silence-detector] Silence confirmed ({elapsed:.1f}s)")
        
        if verbose:
            print("[silence-detector] Done")
        
        return self.speech_detected

def wait_for_silence(silence_threshold=0.02, 
                     silence_duration=2.0, 
                     verbose=True):
    """
    Convenience function to detect silence.
    
    Returns:
        bool: True if speech was detected, False if no speech
    """
    detector = SilenceDetector(
        silence_threshold=silence_threshold,
        silence_duration=silence_duration
    )
    return detector.wait_for_silence(verbose=verbose)

if __name__ == "__main__":
    # Test the detector
    print("Silence Detector Test")
    print("=====================")
    print("Start speaking into your microphone...")
    print()
    
    speech_detected = wait_for_silence(
        silence_threshold=0.02,
        silence_duration=2.0,
        verbose=True
    )
    
    if speech_detected:
        print("\n✓ Speech was detected and silence confirmed")
    else:
        print("\n✗ No speech detected")
