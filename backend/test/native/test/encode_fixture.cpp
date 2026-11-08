#include "BackendDeltaCodec.h"
#include "BackendTrustLifecycle.h"
#include <iostream>
#include <vector>
#include <string>
#include <cstdlib>
static std::vector<uint8_t> decode(const std::string& value){
 std::vector<uint8_t> out;for(size_t i=0;i<value.size();i+=2)out.push_back(static_cast<uint8_t>(std::stoul(value.substr(i,2),nullptr,16)));return out;
}
int main(int argc,char**argv){
 if(argc==8 && std::string(argv[1])=="--state"){
  auto id=decode(argv[2]);if(id.size()!=8)return 3;uint8_t out[TratumTrustV3::STATE_BYTES];
  if(!TratumTrustV3::encodeState(id.data(),std::stoul(argv[3]),std::stoul(argv[4]),std::stoul(argv[5]),std::stoull(argv[6]),std::stoul(argv[7]),out))return 4;
  const char digits[]="0123456789abcdef";for(auto value:out)std::cout<<digits[value>>4]<<digits[value&15];return 0;
 }
 if(argc==15 && std::string(argv[1])=="--transition"){
  auto id=decode(argv[2]),challenge=decode(argv[3]),root=decode(argv[10]),oldKey=decode(argv[11]),newKey=decode(argv[12]),issuer=decode(argv[13]);
  if(id.size()!=8||challenge.size()!=32||root.size()!=32||oldKey.size()!=64||newKey.size()!=64||issuer.size()!=32)return 3;
  uint8_t out[TratumTrustV3::TRANSITION_BYTES];
  if(!TratumTrustV3::encode(id.data(),challenge.data(),std::stoul(argv[4]),std::stoul(argv[5]),std::stoul(argv[6]),std::stoul(argv[7]),std::stoul(argv[8]),std::stoul(argv[9]),root.data(),oldKey.data(),newKey.data(),issuer.data(),std::stoul(argv[14]),out))return 4;
  const char digits[]="0123456789abcdef";for(auto value:out)std::cout<<digits[value>>4]<<digits[value&15];return 0;
 }
 if(argc==5 && std::string(argv[1])=="--enroll") {
  auto challenge=decode(argv[2]),pub=decode(argv[3]),issuer=decode(argv[4]);
  if(challenge.size()!=32 || pub.size()!=64 || issuer.size()!=32)return 3;
  uint8_t message[TratumDeltaV2::ENROLLMENT_BYTES];
  if(!TratumDeltaV2::encodeEnrollment(challenge.data(),pub.data(),issuer.data(),message))return 4;
  const char digits[]="0123456789abcdef";for(auto value:message)std::cout<<digits[value>>4]<<digits[value&15];return 0;
 }
 if(argc!=7)return 2;
 auto id=decode(argv[1]),previous=decode(argv[4]),raw=decode(argv[5]),root=decode(argv[6]);
 if(id.size()!=8 || previous.size()!=32 || root.size()!=32 || raw.empty() || raw.size()%176)return 3;
 std::vector<uint8_t> out(98+raw.size());
 const auto count=raw.size()/176;
 const size_t written=TratumDeltaV2::encode(id.data(),std::stoul(argv[2]),std::stoul(argv[3]),previous.data(),reinterpret_cast<const Transaction_t*>(raw.data()),count,root.data(),out.data(),out.size());
 if(!written)return 4;
 const char digits[]="0123456789abcdef";for(size_t i=0;i<written;++i)std::cout<<digits[out[i]>>4]<<digits[out[i]&15];
}
