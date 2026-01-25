import { OfflineLicense } from "@/backend/lib/OfflineLicense";
import { ConnectionState } from "@/common/appdb/Connection";
import { LicenseKey } from "@/common/appdb/models/LicenseKey";
import { TransportLicenseKey } from "@/common/transport";
import { LicenseStatus } from "@/lib/license";
import { InstallationId } from "@/common/appdb/models/installation_id";
import { createHash } from 'crypto';
import * as os from 'os';

export interface ILicenseHandlers {
  "license/createTrialLicense": () => Promise<void>;
  "license/getStatus": () => Promise<LicenseStatus>;
  "license/get": () => Promise<TransportLicenseKey[]>;
  "license/remove": (({ id }: { id: number }) => Promise<void>);
  "license/wipe": () => Promise<void>;
  "license/getInstallationId": () => Promise<string>;
  "license/getDeviceId": () => Promise<string>;
  "license/getDeviceInfo": () => Promise<{ deviceId: string; deviceName: string; deviceOS: string }>;
}

export const LicenseHandlers: ILicenseHandlers = {
  "license/createTrialLicense": async function () {
    await LicenseKey.createTrialLicense();
  },
  "license/remove": async function({ id }){
    const key = await LicenseKey.findOneBy({ id })
    if (key) {
      await key.remove()
    }
  },
  "license/getStatus": async function () {
    // If someone has a file-based license, that takes
    // priority over ALL other licenses
    const offline = OfflineLicense.load()
    let status = null
    if (offline && offline.isValid) {
      status = offline.toLicenseStatus()
    } else {
      status = await LicenseKey.getLicenseStatus();
    }
    return {
      ...status,
      isUltimate: status.isUltimate,
      isCommunity: status.isCommunity,
      isTrial: status.isTrial,
      isValidDateExpired: status.isValidDateExpired,
      isSupportDateExpired: status.isSupportDateExpired,
      maxAllowedVersion: status.maxAllowedVersion,
    };
  },
  "license/get": async function () {
    const offline = OfflineLicense.load()
    if (offline) {
      const licenseKey = offline.toLicenseKey();
      if (licenseKey) return [licenseKey];
    }
    return await LicenseKey.find();
  },
  "license/wipe": async function() {
    await LicenseKey.wipe();
  },
  "license/getInstallationId": async function() {
    // Make sure we return a string, not null
    const id = await InstallationId.get();
    return id || "";
  },
  "license/getDeviceId": async function() {
    // Generate hardware-based device ID for trial tracking
    try {
      const machineInfo = [
        os.hostname(),
        os.platform(),
        os.arch(),
        os.cpus()[0]?.model || 'unknown',
        os.totalmem().toString(),
      ].join('|')
      
      const hash = createHash('sha256').update(machineInfo).digest('hex')
      
      // Format as UUID (8-4-4-4-12)
      const deviceUuid = [
        hash.substring(0, 8),
        hash.substring(8, 12),
        hash.substring(12, 16),
        hash.substring(16, 20),
        hash.substring(20, 32)
      ].join('-')
      
      return deviceUuid
    } catch (error) {
      console.error('Failed to generate device ID:', error)
      // Fallback: use hostname-based ID
      const fallbackId = `${os.hostname()}-${os.platform()}-${os.arch()}`
      const hash = createHash('sha256').update(fallbackId).digest('hex')
      
      return [
        hash.substring(0, 8),
        hash.substring(8, 12),
        hash.substring(12, 16),
        hash.substring(16, 20),
        hash.substring(20, 32)
      ].join('-')
    }
  },
  "license/getDeviceInfo": async function() {
    // Get device information for license binding
    return {
      deviceId: await LicenseHandlers["license/getDeviceId"](),
      deviceName: os.hostname(),
      deviceOS: `${os.type()} ${os.release()}`
    }
  }
};
