#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
namespace TratumTrustV3 {
constexpr size_t TRANSITION_BYTES=270;
constexpr size_t STATE_BYTES=45;
inline void u32(uint8_t* out,uint32_t value){for(unsigned i=0;i<4;++i)out[i]=static_cast<uint8_t>(value>>(8*i));}
inline bool encodeState(const uint8_t device[8],uint32_t epoch,uint32_t era,uint8_t slot,uint64_t counter,uint32_t timestamp,uint8_t out[STATE_BYTES]){
 if(!device||!out||slot>1)return false;
 const char domain[]="TRATUM-STATE-V3";static_assert(sizeof(domain)==16,"State domain ABI changed");
 memcpy(out,domain,16);memcpy(out+16,device,8);u32(out+24,epoch);u32(out+28,era);out[32]=slot;
 for(unsigned i=0;i<8;++i)out[33+i]=static_cast<uint8_t>(counter>>(8*i));u32(out+41,timestamp);return true;
}
inline bool encode(const uint8_t device[8],const uint8_t challenge[32],uint32_t oldEpoch,uint32_t newEpoch,
 uint8_t oldSlot,uint8_t newSlot,uint32_t era,uint32_t index,const uint8_t root[32],const uint8_t oldKey[64],
 const uint8_t newKey[64],const uint8_t institutionHash[32],uint32_t expiry,uint8_t out[TRANSITION_BYTES]){
 if(!device||!challenge||!root||!oldKey||!newKey||!institutionHash||!out||oldSlot>1||newSlot>1)return false;
 const char domain[]="TRATUM-TRUST-V3";static_assert(sizeof(domain)==16,"Domain ABI changed");
 memcpy(out,domain,16);memcpy(out+16,device,8);memcpy(out+24,challenge,32);u32(out+56,oldEpoch);u32(out+60,newEpoch);
 out[64]=oldSlot;out[65]=newSlot;u32(out+66,era);u32(out+70,index);memcpy(out+74,root,32);memcpy(out+106,oldKey,64);
 memcpy(out+170,newKey,64);memcpy(out+234,institutionHash,32);u32(out+266,expiry);return true;
}
}
