'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  confirmReaderKeyAction,
  openReaderSessionAction,
  registerReaderAction,
  rotateReaderKeyAction,
} from '@/app/(admin)/admin/actions';
import type { BluetoothLike } from '@/lib/reader/bluetooth-link';
import type { ReaderResponse } from '@/lib/reader/protocol';
import {
  EMPTY_READER_SNAPSHOT,
  ReaderManager,
  type ReaderSnapshot,
} from '@/lib/reader/reader-manager';
import type { SerialLike } from '@/lib/reader/serial-link';

// One connection for the whole tab, so moving between Cards and the kiosk keeps
// the reader instead of connecting to it again.
let manager: ReaderManager | null = null;

function readerManager(): ReaderManager {
  if (!manager) {
    const browser = navigator as Navigator & { serial?: SerialLike; bluetooth?: BluetoothLike };
    manager = new ReaderManager({
      serial: browser.serial ?? null,
      bluetooth: browser.bluetooth ?? null,
      openSession: openReaderSessionAction,
      registerReader: registerReaderAction,
      rotateKey: rotateReaderKeyAction,
      confirmKey: confirmReaderKeyAction,
    });
  }
  return manager;
}

const subscribe = (listener: () => void) => readerManager().subscribe(listener);
const getSnapshot = () => readerManager().getSnapshot();
const getServerSnapshot = () => EMPTY_READER_SNAPSHOT;

// Stable, so effects that read cards do not restart on every render.
const sendCommand = (
  cmd: string,
  extra?: Record<string, unknown>,
  timeoutMs?: number,
): Promise<ReaderResponse> => readerManager().send(cmd, extra, timeoutMs);
const connect = () => readerManager().connectUsb();
const connectBluetooth = () => readerManager().connectBluetooth();
const switchToUsb = () => readerManager().switchToUsb();
const disconnect = () => readerManager().disconnect();
const setBluetoothAllowed = (allowed: boolean) => readerManager().setBluetoothAllowed(allowed);
const rotateKey = () => readerManager().rotateKey();

export type Reader = ReaderSnapshot & {
  /** Connect by cable. */
  connect(): Promise<void>;
  connectBluetooth(): Promise<void>;
  switchToUsb(): Promise<void>;
  disconnect(): Promise<void>;
  sendCommand: typeof sendCommand;
  setBluetoothAllowed(allowed: boolean): Promise<void>;
  /** Gives the connected reader a new key; says how it went. */
  rotateKey(): Promise<{ ok: boolean; message: string }>;
};

/** The NFC reader, over its cable or over Bluetooth, whichever is in use. */
export function useReader(): Reader {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => readerManager().retain(), []);
  return {
    ...state,
    connect,
    connectBluetooth,
    switchToUsb,
    disconnect,
    sendCommand,
    setBluetoothAllowed,
    rotateKey,
  };
}
