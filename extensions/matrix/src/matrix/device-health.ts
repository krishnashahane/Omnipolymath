export type MatrixManagedDeviceInfo = {
  deviceId: string;
  displayName: string | null;
  current: boolean;
};

export function listStaleOmnipolymathMatrixDevices(
  devices: MatrixManagedDeviceInfo[],
): MatrixManagedDeviceInfo[] {
  return devices.filter(
    (device) => !device.current && device.displayName?.startsWith("Omnipolymath ") === true,
  );
}
