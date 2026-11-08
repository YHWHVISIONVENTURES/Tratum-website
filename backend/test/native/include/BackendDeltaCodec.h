#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include "Transaction.h"

namespace TratumDeltaV2 {
static_assert(sizeof(Transaction_t)==176,"Transaction ABI changed: introduce a new wire version");
constexpr size_t MAX_RECORDS=32;
constexpr size_t HEADER_BYTES=66;
constexpr size_t FIXED_BYTES=98;
constexpr size_t ENROLLMENT_BYTES=145;
inline bool encodeEnrollment(const uint8_t challenge[32],const uint8_t publicKey[64],const uint8_t institutionHash[32],uint8_t out[ENROLLMENT_BYTES]) {
 if(!challenge || !publicKey || !institutionHash || !out) return false;
 const char domain[]="TRATUM-ENROLL-V2";
 static_assert(sizeof(domain)==17,"Enrollment domain size");
 memcpy(out,domain,17);memcpy(out+17,challenge,32);memcpy(out+49,publicKey,64);memcpy(out+113,institutionHash,32);return true;
}
inline void u32(uint8_t* out,uint32_t value) {
 for(unsigned i=0;i<4;++i) out[i]=static_cast<uint8_t>(value>>(8*i));
}
// All fields are explicitly encoded. ESP32 little-endian transaction ABI is guarded above.
inline size_t encode(const uint8_t device[8],uint32_t epoch,uint32_t from,
 const uint8_t previous[32],const Transaction_t* records,uint16_t count,
 const uint8_t root[32],uint8_t* out,size_t capacity) {
 if(!device || !previous || !records || !root || !out || !count ||
  count>MAX_RECORDS || from>UINT32_MAX-count || capacity<FIXED_BYTES+count*sizeof(Transaction_t)) return 0;
 const char domain[16]="TRATUM-DELTA-V2";
 memcpy(out,domain,16);memcpy(out+16,device,8);u32(out+24,epoch);u32(out+28,from);
 out[32]=static_cast<uint8_t>(count);out[33]=static_cast<uint8_t>(count>>8);
 memcpy(out+34,previous,32);
 if(out+HEADER_BYTES!=reinterpret_cast<const uint8_t*>(records)) memcpy(out+HEADER_BYTES,records,count*sizeof(Transaction_t));
 memcpy(out+HEADER_BYTES+count*sizeof(Transaction_t),root,32);
 return FIXED_BYTES+count*sizeof(Transaction_t);
}
}
