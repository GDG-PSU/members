'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gdg/ui';

const SCAN_INTERVAL_MS = 120;

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') {
    return 'Camera access was blocked. Allow the camera for this site in the address bar, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is in use by another app. Close it and try again.';
  }
  return 'The camera could not be started.';
}

/** Runs only while the dialog is open, so the camera light goes off when it closes. */
function Scanner({ onResult }: { onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onResultRef = useRef(onResult);
  const [error, setError] = useState('');

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    let stream: MediaStream | null = null;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    function scan() {
      if (stopped) return;
      const video = videoRef.current;
      const width = video?.videoWidth ?? 0;
      const height = video?.videoHeight ?? 0;
      if (video && context && width > 0 && height > 0) {
        canvas.width = width;
        canvas.height = height;
        context.drawImage(video, 0, 0, width, height);
        const code = jsQR(context.getImageData(0, 0, width, height).data, width, height, {
          inversionAttempts: 'dontInvert',
        });
        if (code?.data) {
          stopped = true;
          onResultRef.current(code.data);
          return;
        }
      }
      timer = window.setTimeout(scan, SCAN_INTERVAL_MS);
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser cannot use a camera here.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        const video = videoRef.current;
        if (stopped || !video) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        scan();
      } catch (cameraError) {
        if (!stopped) setError(cameraErrorMessage(cameraError));
      }
    }

    void start();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="space-y-3">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <video
        ref={videoRef}
        muted
        playsInline
        aria-label="Camera preview"
        className="aspect-[4/3] w-full bg-black object-cover"
      />
      <p className="text-sm leading-relaxed text-muted-foreground">
        Ask the member to open <strong>Digital ID</strong> on their phone and hold the code up to
        the camera.
      </p>
    </div>
  );
}

export function QrScanDialog({
  open,
  onClose,
  onResult,
}: {
  open: boolean;
  onClose: () => void;
  onResult: (text: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scan a member&apos;s QR code</DialogTitle>
        </DialogHeader>
        {open ? <Scanner onResult={onResult} /> : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
