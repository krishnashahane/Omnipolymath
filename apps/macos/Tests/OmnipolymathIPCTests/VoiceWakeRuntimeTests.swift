import SwabbleKit
import Testing
@testable import Omnipolymath

struct VoiceWakeRuntimeTests {
    @Test(arguments: ["hey omnipolymath", "tell me about omnipolymath"])
    func `diagnostic trigger only fallback rejects trailing mentions`(transcript: String) {
        let match = VoiceWakeRecognitionDebugSupport.triggerOnlyFallbackMatch(
            transcript: transcript,
            triggers: ["omnipolymath"],
            trimWake: WakeWordGate.stripWake)
        if transcript == "hey omnipolymath" {
            #expect(match?.command == "")
            #expect(match?.trigger == "omnipolymath")
        } else {
            #expect(match == nil)
        }
    }

    @Test func `trims after trigger keeps post speech`() {
        let triggers = ["claude", "omnipolymath"]
        let text = "hey Claude how are you"
        #expect(VoiceWakeRuntime.trimmedAfterTrigger(text, triggers: triggers) == "how are you")
    }

    @Test func `trims after trigger returns original when no trigger`() {
        let triggers = ["claude"]
        let text = "good morning friend"
        #expect(VoiceWakeRuntime.trimmedAfterTrigger(text, triggers: triggers) == text)
    }

    @Test func `trims after first matching trigger`() {
        let triggers = ["buddy", "claude"]
        let text = "hello buddy this is after trigger claude also here"
        #expect(VoiceWakeRuntime
            .trimmedAfterTrigger(text, triggers: triggers) == "this is after trigger claude also here")
    }

    @Test func `has content after trigger false when only trigger`() {
        let triggers = ["omnipolymath"]
        let text = "hey omnipolymath"
        #expect(VoiceWakeRuntime.trimmedAfterTrigger(text, triggers: triggers).isEmpty)
    }

    @Test func `has content after trigger true when speech continues`() {
        let triggers = ["claude"]
        let text = "claude write a note"
        #expect(!VoiceWakeRuntime.trimmedAfterTrigger(text, triggers: triggers).isEmpty)
    }

    @Test func `trigger only allows filler before trigger`() {
        let triggers = ["omnipolymath"]
        let text = "uh omnipolymath"
        #expect(VoiceWakeRuntime.isTriggerOnlyText(transcript: text, triggers: triggers))
    }

    @Test func `trigger only rejects trailing wake word mentions in ordinary speech`() {
        let triggers = ["omnipolymath"]
        let text = "tell me about omnipolymath"
        #expect(!VoiceWakeRuntime.isTriggerOnlyText(transcript: text, triggers: triggers))
    }

    @Test func `matched trigger finds trigger not at transcript start`() {
        let triggers = ["omnipolymath"]
        let text = "uh omnipolymath"
        #expect(VoiceWakeTextUtils.matchedTriggerWord(transcript: text, triggers: triggers) == "omnipolymath")
    }

    @Test func `matched trigger rejects larger word suffix matches`() {
        let triggers = ["computer"]
        let text = "uh computers"
        #expect(VoiceWakeTextUtils.matchedTriggerWord(transcript: text, triggers: triggers) == nil)
    }

    @Test func `matched trigger prefers most specific overlapping phrase`() {
        let triggers = ["omnipolymath", "hey omnipolymath"]
        let text = "hey omnipolymath"
        #expect(VoiceWakeTextUtils.matchedTriggerWord(transcript: text, triggers: triggers) == "hey omnipolymath")
    }

    @Test func `matched trigger handles width insensitive forms without whitespace tokens`() {
        let triggers = ["omnipolymath"]
        let text = "ＯｐｅｎＣｌａｗ"
        #expect(VoiceWakeTextUtils.matchedTriggerWord(transcript: text, triggers: triggers) == "omnipolymath")
    }

    @Test func `matched trigger handles chinese forms without whitespace tokens`() {
        let triggers = ["小爪"]
        let text = "嘿小爪"
        #expect(VoiceWakeTextUtils.matchedTriggerWord(transcript: text, triggers: triggers) == "小爪")
    }

    @Test func `text only fallback populates matched trigger`() {
        let transcript = "hey omnipolymath do thing"
        let config = WakeWordGateConfig(triggers: ["omnipolymath"], minCommandLength: 1)
        let match = VoiceWakeRecognitionDebugSupport.textOnlyFallbackMatch(
            transcript: transcript,
            triggers: ["omnipolymath"],
            config: config,
            trimWake: VoiceWakeRuntime.trimmedAfterTrigger)
        #expect(match?.trigger == "omnipolymath")
    }

    @Test func `text only fallback keeps the first trigger phrase when later words match another trigger`() {
        let transcript = "omnipolymath tell me about computer vision"
        let config = WakeWordGateConfig(triggers: ["omnipolymath", "computer"], minCommandLength: 1)
        let match = VoiceWakeRecognitionDebugSupport.textOnlyFallbackMatch(
            transcript: transcript,
            triggers: ["omnipolymath", "computer"],
            config: config,
            trimWake: VoiceWakeRuntime.trimmedAfterTrigger)
        #expect(match?.trigger == "omnipolymath")
    }

    @Test func `text only fallback rejects filler prefixed larger word suffix matches`() {
        let transcript = "uh computers"
        let config = WakeWordGateConfig(triggers: ["computer"], minCommandLength: 1)
        let match = VoiceWakeRecognitionDebugSupport.textOnlyFallbackMatch(
            transcript: transcript,
            triggers: ["computer"],
            config: config,
            trimWake: VoiceWakeRuntime.trimmedAfterTrigger)
        #expect(match == nil)
    }

    @Test func `trims after chinese trigger keeps post speech`() {
        let triggers = ["小爪", "omnipolymath"]
        let text = "嘿 小爪 帮我打开设置"
        #expect(VoiceWakeRuntime.trimmedAfterTrigger(text, triggers: triggers) == "帮我打开设置")
    }

    @Test func `trims after trigger handles width insensitive forms`() {
        let triggers = ["omnipolymath"]
        let text = "ＯｐｅｎＣｌａｗ 请帮我"
        #expect(VoiceWakeRuntime.trimmedAfterTrigger(text, triggers: triggers) == "请帮我")
    }
}
