#ifndef OMNIPOLYMATH_WATCH_RTC_H
#define OMNIPOLYMATH_WATCH_RTC_H
#include <stddef.h>
#include <stdint.h>

typedef struct OmnipolymathRTC OmnipolymathRTC;
typedef struct {
    uint8_t address[16];
    uint16_t port;
    uint16_t family; /* 4 or 6; bytes are in network order. */
} OmnipolymathRTCAddress;

typedef struct {
    uint32_t kind; /* 0 timeout, 1 UDP, 2 connected, 3 Opus, 4 disconnected, 5 closed. */
    const uint8_t *bytes;
    size_t length;
    OmnipolymathRTCAddress source;
    OmnipolymathRTCAddress destination;
    uint64_t time; /* Timeout milliseconds, or Opus RTP timestamp at 48 kHz. */
} OmnipolymathRTCOutput;

/* One serial owner. After EVERY mutation, poll to kind=0 before mutating again.
 * Returned byte pointers expire at the next call; copy before returning to the run loop.
 * Results: 0 success, -1 failed/closed, -2 invalid input,
 * -3 unsupported answer (requires ICE-lite with UDP candidates), -4 candidate budget.
 * No network I/O occurs here. */
OmnipolymathRTC *omnipolymath_rtc_create(void);
void omnipolymath_rtc_free(OmnipolymathRTC *rtc);
int32_t omnipolymath_rtc_add_candidate(OmnipolymathRTC *rtc, OmnipolymathRTCAddress address);
int32_t omnipolymath_rtc_remove_candidate(OmnipolymathRTC *rtc, OmnipolymathRTCAddress address);
int32_t omnipolymath_rtc_offer(OmnipolymathRTC *rtc);
const uint8_t *omnipolymath_rtc_description(const OmnipolymathRTC *rtc, size_t *length);
int32_t omnipolymath_rtc_answer(OmnipolymathRTC *rtc, const uint8_t *bytes, size_t length);
/* Read-only discovery inventory after answer; 0 address, 1 end, -1 failed/closed.
 * Does not replace or filter the engine's authenticated candidate checklist. */
int32_t omnipolymath_rtc_remote_address(const OmnipolymathRTC *rtc, size_t index,
                                  OmnipolymathRTCAddress *address);
/* Add a system-resolved IPv6 route for an original IPv4 inventory entry.
 * Preserve the original ICE attributes and port; repeated routes are idempotent.
 * The combined original/resolved endpoint inventory is bounded to 100. */
int32_t omnipolymath_rtc_resolve_remote_address(OmnipolymathRTC *rtc, size_t index,
                                          OmnipolymathRTCAddress address);
int32_t omnipolymath_rtc_receive(OmnipolymathRTC *rtc, OmnipolymathRTCAddress source,
                           OmnipolymathRTCAddress destination, const uint8_t *bytes, size_t length);
int32_t omnipolymath_rtc_send_opus(OmnipolymathRTC *rtc, const uint8_t *bytes, size_t length,
                             uint64_t timestamp);
int32_t omnipolymath_rtc_timeout(OmnipolymathRTC *rtc);
int32_t omnipolymath_rtc_poll(OmnipolymathRTC *rtc, OmnipolymathRTCOutput *output);
#endif
