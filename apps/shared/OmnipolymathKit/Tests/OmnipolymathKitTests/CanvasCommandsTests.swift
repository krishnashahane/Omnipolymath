import Foundation
import OmnipolymathKit
import Testing

struct CanvasCommandsTests {
    @Test func `presenter command strings are stable`() {
        #expect(OmnipolymathCanvasCommand.present.rawValue == "canvas.present")
        #expect(OmnipolymathCanvasCommand.hide.rawValue == "canvas.hide")
        #expect(OmnipolymathCanvasCommand.navigate.rawValue == "canvas.navigate")
    }

    @Test func `presenter params decode shipped wire shapes`() throws {
        let presentData = try #require(
            """
            {"url":"omnipolymath-canvas://widget.html","placement":{"x":1,"y":2,"width":3,"height":4}}
            """.data(using: .utf8))
        let present = try JSONDecoder().decode(OmnipolymathCanvasPresentParams.self, from: presentData)
        #expect(present.url == "omnipolymath-canvas://widget.html")
        #expect(present.placement?.x == 1)
        #expect(present.placement?.y == 2)
        #expect(present.placement?.width == 3)
        #expect(present.placement?.height == 4)

        let navigateData = try #require(
            "{\"url\":\"omnipolymath-canvas://next.html\"}".data(using: .utf8))
        let navigate = try JSONDecoder().decode(OmnipolymathCanvasNavigateParams.self, from: navigateData)
        #expect(navigate.url == "omnipolymath-canvas://next.html")
    }
}
