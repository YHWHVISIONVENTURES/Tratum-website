# Native wire compatibility fixture

Source snapshots of the recovered firmware's `BackendDeltaCodec.h`, `Transaction.h`, and `test/encode_fixture.cpp` allow backend CI to compile the same encoder without the ESP32 toolchain. Set `TRATUM_FIRMWARE_PATH` to test the active firmware directly. Update these snapshots when the firmware ABI changes. A pass establishes wire compatibility; it does not verify physical hardware, payment state or power-loss recovery.
