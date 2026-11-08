#ifndef TRANSACTION_H    // 🛡️ 1. ADD THIS AT THE TOP
#define TRANSACTION_H    // 🛡️ 2. ADD THIS AT THE TOP

#pragma once
#include <stdint.h>

#define TRANSACTION_HASH_SIZE        32
#define TRANSACTION_SIGNATURE_SIZE   64
// Transaction flags
#define TX_FLAG_OFFLINE 0x01

#define TX_HASH_DATA_SIZE (sizeof(Transaction_t) - TRANSACTION_SIGNATURE_SIZE)

typedef struct __attribute__((packed)) {
    uint32_t amount;
    uint32_t timestamp;
    uint8_t senderID[8];
    uint8_t receiverID[8];
    uint64_t nonce;

    uint8_t reserved[7];
    uint8_t tx_hash[TRANSACTION_HASH_SIZE];
    uint8_t prev_hash[TRANSACTION_HASH_SIZE];
    uint8_t signature[TRANSACTION_SIGNATURE_SIZE];

    uint8_t status;          // 0=pending,1=confirmed,2=rejected
    uint8_t synced;          // 0 = not synced, 1 = synced
    uint8_t conflict_flag;   // 0 = clean, 1 = conflict
    uint8_t dispute_code;    // reason code
    uint8_t flags;           // transaction flags (e.g., offline)
    uint32_t key_epoch;
} Transaction_t;

// =====================================================
// PAYMENT PAYLOAD – TRANSPORT ENVELOPE
// =====================================================
typedef struct __attribute__((packed)) {
    Transaction_t transaction;        // Embedded ledger record

    // Session & Security Context
    uint8_t session_token[32];        // Session binding token
    uint8_t attestation_token[32];    // Hardware attestation proof

    // Policy Flags
    uint8_t offline_flag;             // Indicates offline transaction
    uint8_t dispute_flag;             // Indicates dispute condition

    // Versioning for forward compatibility
    uint16_t payload_version;
} PaymentPayload;

#endif // TRANSACTION_H
