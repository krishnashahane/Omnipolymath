#ifndef OMNIPOLYMATH_CAMERA_PTZ_NATIVE_H
#define OMNIPOLYMATH_CAMERA_PTZ_NATIVE_H

#include <stddef.h>
#include <stdint.h>

typedef struct OmnipolymathUVCController OmnipolymathUVCController;

int omnipolymath_uvc_parse_camera_terminal_descriptor(
    const uint8_t *descriptor,
    size_t descriptor_length,
    uint8_t *terminal_id_out,
    uint32_t *controls_out
);

int omnipolymath_uvc_open(
    uint32_t location_id,
    uint16_t vendor_id,
    uint16_t product_id,
    OmnipolymathUVCController **controller_out,
    uint32_t *controls_out,
    char **error_out
);

int omnipolymath_uvc_control(
    OmnipolymathUVCController *controller,
    uint8_t selector,
    uint8_t request,
    void *data,
    uint16_t length,
    char **error_out
);

void omnipolymath_uvc_close(OmnipolymathUVCController *controller);

#endif
