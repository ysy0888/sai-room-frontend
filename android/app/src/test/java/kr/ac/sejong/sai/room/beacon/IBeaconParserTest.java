package kr.ac.sejong.sai.room.beacon;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class IBeaconParserTest {
    static final String UUID = "11111111-2222-3333-4444-555555555555";

    static byte[] frame(String uuid, int major, int minor, int tx) {
        byte[] f = new byte[23];
        f[0] = 0x02; f[1] = 0x15;
        System.arraycopy(IBeaconParser.uuidBytes(uuid), 0, f, 2, 16);
        f[18] = (byte) (major >> 8); f[19] = (byte) major;
        f[20] = (byte) (minor >> 8); f[21] = (byte) minor;
        f[22] = (byte) tx;
        return f;
    }

    @Test public void parsesUuidMajorMinorAndTxPower() {
        IBeaconParser.Beacon b = IBeaconParser.parse(frame("FDA50693-A4E2-4FB1-AFCF-C6EB07647825", 10001, 65535, -59));
        assertEquals("fda50693-a4e2-4fb1-afcf-c6eb07647825", b.uuid);
        assertEquals(10001, b.major);
        assertEquals(65535, b.minor);
        assertEquals(-59, b.txPower);
    }

    @Test public void rejectsNonIBeaconData() {
        assertNull(IBeaconParser.parse(null));
        assertNull(IBeaconParser.parse(new byte[22]));
        byte[] f = frame(UUID, 1, 1, -59); f[1] = 0x16;
        assertNull(IBeaconParser.parse(f));
    }

    @Test public void matchingTreatsNullMajorMinorAsAny() {
        IBeaconParser.Beacon b = IBeaconParser.parse(frame(UUID, 1, 2, -59));
        assertTrue(b.matches(UUID.toUpperCase(), 1, 2));
        assertTrue(b.matches(UUID, 1, null));
        assertTrue(b.matches(UUID, null, null));
        assertFalse(b.matches(UUID, 1, 3));
        assertFalse(b.matches("99999999-2222-3333-4444-555555555555", 1, 2));
        assertFalse(b.matches(null, 1, 2));
    }

    @Test public void filterMatchesItsOwnFrameUnderMask() {
        byte[] data = IBeaconParser.filterData(UUID, 1, null), mask = IBeaconParser.filterMask(1, null);
        assertEquals(22, data.length); assertEquals(22, mask.length);
        byte[] adv = frame(UUID, 1, 777, -59);
        for (int i = 0; i < 22; i++) assertEquals((data[i] & mask[i]), (adv[i] & mask[i]));
        assertArrayEquals(new byte[] {0, 0}, new byte[] {mask[20], mask[21]});
    }

    @Test public void uuidValidation() {
        assertNull(IBeaconParser.uuidBytes("not-a-uuid"));
        assertEquals(16, IBeaconParser.uuidBytes(UUID).length);
    }
}
