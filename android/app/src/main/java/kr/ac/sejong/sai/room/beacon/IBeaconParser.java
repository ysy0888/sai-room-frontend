package kr.ac.sejong.sai.room.beacon;

import java.util.Locale;

/**
 * Pure iBeacon advertisement helpers (no Android dependencies, unit-tested).
 *
 * iBeacon = Apple manufacturer-specific data (company id 0x004C) whose payload is
 * [0x02, 0x15, uuid(16), major(2, big endian), minor(2, big endian), txPower(1)] = 23 bytes.
 * The HE5 set up with the beacon manager app advertises in this format; its UUID/Major/Minor are
 * entered by staff in the SAI app (they are identifiers, not secrets).
 */
public final class IBeaconParser {
    public static final int APPLE = 0x004C;
    static final int LENGTH = 23;

    private IBeaconParser() {}

    public static final class Beacon {
        public final String uuid;
        public final int major;
        public final int minor;
        public final int txPower;

        Beacon(String uuid, int major, int minor, int txPower) {
            this.uuid = uuid;
            this.major = major;
            this.minor = minor;
            this.txPower = txPower;
        }

        /** null major/minor means "any" (staff left the field empty). */
        public boolean matches(String wantedUuid, Integer wantedMajor, Integer wantedMinor) {
            return wantedUuid != null && uuid.equals(wantedUuid.toLowerCase(Locale.ROOT))
                && (wantedMajor == null || major == wantedMajor)
                && (wantedMinor == null || minor == wantedMinor);
        }
    }

    /** Parses manufacturer data for company 0x004C; returns null for anything that is not an iBeacon frame. */
    public static Beacon parse(byte[] data) {
        if (data == null || data.length < LENGTH || data[0] != 0x02 || data[1] != 0x15) return null;
        StringBuilder hex = new StringBuilder(36);
        for (int i = 0; i < 16; i++) {
            if (i == 4 || i == 6 || i == 8 || i == 10) hex.append('-');
            hex.append(String.format(Locale.ROOT, "%02x", data[2 + i] & 0xFF));
        }
        int major = ((data[18] & 0xFF) << 8) | (data[19] & 0xFF);
        int minor = ((data[20] & 0xFF) << 8) | (data[21] & 0xFF);
        return new Beacon(hex.toString(), major, minor, data[22]);
    }

    /** 16 bytes of a canonical UUID string, or null when the string is not a UUID. */
    public static byte[] uuidBytes(String uuid) {
        if (uuid == null || !uuid.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) return null;
        String hex = uuid.replace("-", "");
        byte[] out = new byte[16];
        for (int i = 0; i < 16; i++) out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        return out;
    }

    /** Manufacturer-data pattern for a hardware ScanFilter (22 bytes: prefix, uuid, major, minor). */
    public static byte[] filterData(String uuid, Integer major, Integer minor) {
        byte[] id = uuidBytes(uuid);
        if (id == null) throw new IllegalArgumentException("invalid uuid");
        byte[] out = new byte[22];
        out[0] = 0x02;
        out[1] = 0x15;
        System.arraycopy(id, 0, out, 2, 16);
        if (major != null) { out[18] = (byte) (major >> 8); out[19] = (byte) (int) major; }
        if (minor != null) { out[20] = (byte) (minor >> 8); out[21] = (byte) (int) minor; }
        return out;
    }

    /** Mask matching {@link #filterData}: 0xFF where a byte must match, 0x00 for "any". */
    public static byte[] filterMask(Integer major, Integer minor) {
        byte[] out = new byte[22];
        for (int i = 0; i < 18; i++) out[i] = (byte) 0xFF;
        if (major != null) { out[18] = (byte) 0xFF; out[19] = (byte) 0xFF; }
        if (minor != null) { out[20] = (byte) 0xFF; out[21] = (byte) 0xFF; }
        return out;
    }
}
