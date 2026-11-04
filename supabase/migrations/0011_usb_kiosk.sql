-- USB kiosk scans are created by an authenticated admin after reading a card
-- over the browser-local Web Serial lane. They have no server-registered device.
-- The existing confirm_scan transaction remains the only attendance authority.
alter table public.device_scans
  alter column device_id drop not null;

comment on column public.device_scans.device_id is
  'Null for browser-local USB kiosk scans; the admin session and confirm_scan remain authoritative.';

comment on table public.device_scans is
  'A scan queues intent only. Registered lanes and the local USB kiosk both require an authenticated admin to confirm attendance.';
