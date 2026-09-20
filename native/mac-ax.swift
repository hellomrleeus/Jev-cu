import Cocoa
import ApplicationServices
import Foundation

// MARK: - Models and Cache

struct CachedElement {
    let index: Int
    let element: AXUIElement
    let role: String
    let label: String
    let bounds: CGRect
    let center: CGPoint
}

func sanitize(_ str: String) -> String {
    return str.replacingOccurrences(of: "[\r\n\t]+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
}

class AXSession {
    static let shared = AXSession()
    
    var currentApp: NSRunningApplication? = nil
    var currentAppElem: AXUIElement? = nil
    var cachedElements: [CachedElement] = []
    
    func bind(appName: String) -> (ok: Bool, message: String) {
        let ws = NSWorkspace.shared
        let running = ws.runningApplications
        
        // Exact or case-insensitive match
        var matched = running.first {
            $0.localizedName?.lowercased() == appName.lowercased() ||
            $0.bundleIdentifier?.lowercased() == appName.lowercased()
        }
        
        // If not found, try common bundles or open application
        if matched == nil {
            let bundleId = appName.contains(".") ? appName : "com.apple.\(appName.lowercased())"
            if let url = ws.urlForApplication(withBundleIdentifier: bundleId) ??
                         ws.urlsForApplications(toOpen: URL(fileURLWithPath: "/System/Applications/\(appName).app")).first ??
                         ws.urlsForApplications(toOpen: URL(fileURLWithPath: "/Applications/\(appName).app")).first {
                let conf = NSWorkspace.OpenConfiguration()
                let sema = DispatchSemaphore(value: 0)
                ws.openApplication(at: url, configuration: conf) { (app, err) in
                    matched = app
                    sema.signal()
                }
                _ = sema.wait(timeout: .now() + 3.0)
                Thread.sleep(forTimeInterval: 0.5)
            }
        }
        
        guard let app = matched else {
            return (false, "Could not find or launch application: \(appName)")
        }
        
        self.currentApp = app
        self.currentAppElem = AXUIElementCreateApplication(app.processIdentifier)
        
        // Activate app
        app.activate()
        Thread.sleep(forTimeInterval: 0.15)
        
        return (true, "Bound to \(app.localizedName ?? appName) (pid: \(app.processIdentifier))")
    }
    
    func getAXAttribute(_ elem: AXUIElement, _ attr: String) -> CFTypeRef? {
        var val: CFTypeRef?
        let err = AXUIElementCopyAttributeValue(elem, attr as CFString, &val)
        return err == .success ? val : nil
    }
    
    func getAXRoleName(_ elem: AXUIElement) -> String {
        guard let role = getAXAttribute(elem, kAXRoleAttribute) as? String else { return "unknown" }
        let subrole = getAXAttribute(elem, kAXSubroleAttribute) as? String
        
        switch role {
        case "AXWindow":
            if subrole == "AXDialog" { return "dialog" }
            return "standard window"
        case "AXSplitGroup": return "split group"
        case "AXScrollArea": return "scroll area"
        case "AXGroup": return "container"
        case "AXButton":
            if subrole == "AXCloseButton" { return "close button" }
            if subrole == "AXMinimizeButton" { return "minimize button" }
            if subrole == "AXFullScreenButton" { return "full screen button" }
            if subrole == "AXZoomButton" { return "zoom button" }
            return "button"
        case "AXRadioButton": return "radio button"
        case "AXCheckBox": return "checkbox"
        case "AXStaticText": return "text"
        case "AXTextField": return "text field"
        case "AXSearchField": return "search field"
        case "AXPopUpButton": return "pop up button"
        case "AXMenuButton": return "toggle button"
        case "AXMenuBar": return "menu bar"
        case "AXMenuItem": return "menu item"
        case "AXToolbar": return "toolbar"
        case "AXList": return "list"
        case "AXRow": return "row"
        case "AXGrid": return "grid"
        case "AXTab": return "tab"
        case "AXHeading": return "heading"
        case "AXImage": return "image"
        case "AXLink": return "link"
        case "AXDateTime": return "date time area"
        case "AXIncrementor": return "stepper"
        case "AXComboBox": return "combo box"
        default:
            if role.hasPrefix("AX") {
                return String(role.dropFirst(2)).lowercased()
            }
            return role.lowercased()
        }
    }
    
    func observe(maxDepth: Int = 30) -> (ok: Bool, axText: String, elementCount: Int, error: String?) {
        guard let app = currentApp, let appElem = currentAppElem else {
            return (false, "", 0, "No application currently bound. Call bind() first.")
        }
        
        app.activate()
        
        guard let windows = getAXAttribute(appElem, kAXWindowsAttribute) as? [AXUIElement], !windows.isEmpty else {
            return (false, "", 0, "Application has no accessible windows")
        }
        
        let appName = app.localizedName ?? "App"
        var lines: [String] = ["Window: \"\(appName)\", App: \(appName)."]
        var newCache: [CachedElement] = []
        var nextIndex = 0
        
        var focusedUIElementIndex: Int? = nil
        var focusedElemRef: AXUIElement? = nil
        if let focused = getAXAttribute(appElem, kAXFocusedUIElementAttribute) {
            focusedElemRef = (focused as! AXUIElement)
        }
        
        func traverse(_ elem: AXUIElement, depth: Int) {
            if depth > maxDepth { return }
            
            let currentIndex = nextIndex
            nextIndex += 1
            
            let role = getAXRoleName(elem)
            let title = sanitize((getAXAttribute(elem, kAXTitleAttribute) as? String) ?? "")
            let desc = sanitize((getAXAttribute(elem, kAXDescriptionAttribute) as? String) ?? "")
            let help = sanitize((getAXAttribute(elem, kAXHelpAttribute) as? String) ?? "")
            let val = getAXAttribute(elem, kAXValueAttribute)
            let id = sanitize((getAXAttribute(elem, kAXIdentifierAttribute) as? String) ?? "")
            
            // Bounds
            var pos = CGPoint.zero
            var size = CGSize.zero
            if let posVal = getAXAttribute(elem, kAXPositionAttribute) {
                AXValueGetValue(posVal as! AXValue, .cgPoint, &pos)
            }
            if let sizeVal = getAXAttribute(elem, kAXSizeAttribute) {
                AXValueGetValue(sizeVal as! AXValue, .cgSize, &size)
            }
            let center = CGPoint(x: pos.x + size.width / 2, y: pos.y + size.height / 2)
            let bounds = CGRect(origin: pos, size: size)
            
            var pieces: [String] = []
            if !title.isEmpty {
                pieces.append(title)
            }
            if !desc.isEmpty && desc != title {
                pieces.append("Description: \(desc)")
            }
            if !help.isEmpty {
                pieces.append("Help: \(help)")
            }
            if let v = val {
                let vStr = sanitize("\(v)")
                if !vStr.isEmpty {
                    pieces.append("Value: \(vStr)")
                }
            }
            if !id.isEmpty {
                pieces.append("ID: \(id)")
            }
            
            // Actions
            var actionsRef: CFArray?
            if AXUIElementCopyActionNames(elem, &actionsRef) == .success,
               let actions = actionsRef as? [String], !actions.isEmpty {
                let readableActions = actions.compactMap { act -> String? in
                    let clean = sanitize(act.hasPrefix("AX") ? String(act.dropFirst(2)) : act)
                    if clean.isEmpty || clean == "Press" || clean.contains("Selector:") { return nil }
                    return clean
                }
                if !readableActions.isEmpty {
                    pieces.append("Secondary Actions: \(readableActions.joined(separator: ", "))")
                }
            }
            
            let labelText = pieces.joined(separator: ", ")
            let indent = String(repeating: "\t", count: depth)
            let line = "\(indent)\(currentIndex) \(role)" + (labelText.isEmpty ? "" : " " + labelText)
            lines.append(line)
            
            let cached = CachedElement(
                index: currentIndex,
                element: elem,
                role: role,
                label: labelText,
                bounds: bounds,
                center: center
            )
            newCache.append(cached)
            
            if CFEqual(elem, focusedElemRef) {
                focusedUIElementIndex = currentIndex
            }
            
            if let children = getAXAttribute(elem, kAXChildrenAttribute) as? [AXUIElement] {
                for child in children {
                    traverse(child, depth: depth + 1)
                }
            }
        }
        
        for win in windows {
            traverse(win, depth: 0)
        }
        
        if let fIdx = focusedUIElementIndex, fIdx < newCache.count {
            let el = newCache[fIdx]
            lines.append("The focused UI element is \(el.index) \(el.role) \(el.label)")
        }
        
        self.cachedElements = newCache
        return (true, lines.joined(separator: "\n"), newCache.count, nil)
    }
    
    func click(index: Int?, at: CGPoint? = nil, button: String = "left") -> (ok: Bool, error: String?) {
        var clickPoint: CGPoint? = at
        
        if let idx = index {
            guard let item = cachedElements.first(where: { $0.index == idx }) else {
                return (false, "Element index \(idx) not found in cache. Run observe() first.")
            }
            
            // Try AXPressAction first if left click
            if button == "left" {
                let actionRes = AXUIElementPerformAction(item.element, kAXPressAction as CFString)
                if actionRes == .success {
                    return (true, nil)
                }
            }
            
            clickPoint = item.center
        }
        
        guard let pt = clickPoint else {
            return (false, "Neither element index nor coordinates provided for click")
        }
        
        return performMouseClick(at: pt, button: button)
    }
    
    func setValue(index: Int, value: String) -> (ok: Bool, error: String?) {
        guard let item = cachedElements.first(where: { $0.index == index }) else {
            return (false, "Element index \(index) not found in cache")
        }
        
        // Try AXValueAttribute
        let res = AXUIElementSetAttributeValue(item.element, kAXValueAttribute as CFString, value as CFTypeRef)
        if res == .success {
            return (true, nil)
        }
        
        // Fallback: Click element, select all, paste/type
        _ = click(index: index)
        Thread.sleep(forTimeInterval: 0.1)
        _ = pressKey(key: "a", modifiers: [.command])
        Thread.sleep(forTimeInterval: 0.05)
        _ = typeText(text: value)
        return (true, nil)
    }
    
    func typeText(text: String) -> (ok: Bool, error: String?) {
        for char in text {
            let s = String(char)
            let utf16 = Array(s.utf16)
            
            guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
                return (false, "Failed to create keyboard event")
            }
            
            down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            
            down.post(tap: .cghidEventTap)
            Thread.sleep(forTimeInterval: 0.01)
            up.post(tap: .cghidEventTap)
            Thread.sleep(forTimeInterval: 0.01)
        }
        return (true, nil)
    }
    
    struct KeyModifier: OptionSet {
        let rawValue: Int
        static let command = KeyModifier(rawValue: 1 << 0)
        static let shift   = KeyModifier(rawValue: 1 << 1)
        static let option  = KeyModifier(rawValue: 1 << 2)
        static let control = KeyModifier(rawValue: 1 << 3)
    }
    
    func pressKey(key: String, modifiers: KeyModifier = []) -> (ok: Bool, error: String?) {
        let keyMap: [String: CGKeyCode] = [
            "return": 36, "enter": 36,
            "tab": 48,
            "space": 49,
            "delete": 51, "backspace": 51,
            "escape": 53, "esc": 53,
            "command": 55, "shift": 56, "option": 58, "control": 59,
            "left": 123, "right": 124, "down": 125, "up": 126,
            "a": 0, "c": 8, "v": 9, "x": 7, "z": 6
        ]
        
        guard let keyCode = keyMap[key.lowercased()] else {
            return (false, "Unknown key name: \(key)")
        }
        
        var flags: CGEventFlags = []
        if modifiers.contains(.command) { flags.insert(.maskCommand) }
        if modifiers.contains(.shift)   { flags.insert(.maskShift) }
        if modifiers.contains(.option)  { flags.insert(.maskAlternate) }
        if modifiers.contains(.control) { flags.insert(.maskControl) }
        
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false) else {
            return (false, "Failed to create key event")
        }
        
        down.flags = flags
        up.flags = flags
        
        down.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.02)
        up.post(tap: .cghidEventTap)
        return (true, nil)
    }
    
    func scroll(index: Int?, direction: String, pages: Int = 1) -> (ok: Bool, error: String?) {
        var pt = CGPoint.zero
        if let idx = index, let item = cachedElements.first(where: { $0.index == idx }) {
            pt = item.center
        } else if let mainWin = cachedElements.first {
            pt = mainWin.center
        }
        
        let deltaY: Int32 = direction.lowercased() == "up" ? Int32(10 * pages) : (direction.lowercased() == "down" ? Int32(-10 * pages) : 0)
        let deltaX: Int32 = direction.lowercased() == "left" ? Int32(10 * pages) : (direction.lowercased() == "right" ? Int32(-10 * pages) : 0)
        
        guard let scrollEvent = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 2, wheel1: deltaY, wheel2: deltaX, wheel3: 0) else {
            return (false, "Failed to create scroll event")
        }
        scrollEvent.location = pt
        scrollEvent.post(tap: .cghidEventTap)
        return (true, nil)
    }
    
    func drag(from: CGPoint, to: CGPoint) -> (ok: Bool, error: String?) {
        guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left),
              let drag = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: to, mouseButton: .left),
              let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left) else {
            return (false, "Failed to create drag events")
        }
        
        down.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.1)
        drag.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.1)
        up.post(tap: .cghidEventTap)
        return (true, nil)
    }
    
    private func performMouseClick(at pt: CGPoint, button: String = "left") -> (ok: Bool, error: String?) {
        let mouseButton: CGMouseButton = button == "right" ? .right : .left
        let downType: CGEventType = button == "right" ? .rightMouseDown : .leftMouseDown
        let upType: CGEventType = button == "right" ? .rightMouseUp : .leftMouseUp
        
        guard let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: pt, mouseButton: mouseButton),
              let down = CGEvent(mouseEventSource: nil, mouseType: downType, mouseCursorPosition: pt, mouseButton: mouseButton),
              let up = CGEvent(mouseEventSource: nil, mouseType: upType, mouseCursorPosition: pt, mouseButton: mouseButton) else {
            return (false, "Failed to create mouse events")
        }
        
        move.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.02)
        down.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.05)
        up.post(tap: .cghidEventTap)
        return (true, nil)
    }
}

// MARK: - CLI & Daemon Handlers

func runDaemon() {
    let session = AXSession.shared
    
    while true {
        guard let lineData = readLine(strippingNewline: true)?.data(using: .utf8) else {
            break
        }
        
        guard let json = (try? JSONSerialization.jsonObject(with: lineData)) as? [String: Any],
              let cmd = json["cmd"] as? String else {
            printResponse(["ok": false, "error": "Invalid command JSON"])
            continue
        }
        
        switch cmd {
        case "is_trusted":
            let trusted = AXIsProcessTrusted()
            printResponse(["ok": true, "trusted": trusted])
            
        case "apps":
            let apps = NSWorkspace.shared.runningApplications
                .filter { $0.activationPolicy == .regular }
                .map { [
                    "name": $0.localizedName ?? "",
                    "bundleId": $0.bundleIdentifier ?? "",
                    "pid": $0.processIdentifier
                ] }
            printResponse(["ok": true, "apps": apps])
            
        case "bind":
            guard let appName = json["app"] as? String else {
                printResponse(["ok": false, "error": "Missing 'app' param"])
                continue
            }
            let res = session.bind(appName: appName)
            printResponse(["ok": res.ok, "message": res.message, "pid": session.currentApp?.processIdentifier as Any])
            
        case "observe":
            let maxDepth = (json["maxDepth"] as? Int) ?? 30
            let res = session.observe(maxDepth: maxDepth)
            if res.ok {
                printResponse(["ok": true, "axText": res.axText, "count": res.elementCount])
            } else {
                printResponse(["ok": false, "error": res.error ?? "Failed to observe AX tree"])
            }
            
        case "click":
            let index = json["index"] as? Int
            var atPt: CGPoint? = nil
            if let atArr = json["at"] as? [Double], atArr.count >= 2 {
                atPt = CGPoint(x: atArr[0], y: atArr[1])
            }
            let button = (json["button"] as? String) ?? "left"
            let res = session.click(index: index, at: atPt, button: button)
            printResponse(["ok": res.ok, "error": res.error as Any])
            
        case "set_value":
            guard let index = json["index"] as? Int, let val = json["value"] as? String else {
                printResponse(["ok": false, "error": "Missing 'index' or 'value'"])
                continue
            }
            let res = session.setValue(index: index, value: val)
            printResponse(["ok": res.ok, "error": res.error as Any])
            
        case "type_text":
            guard let text = json["text"] as? String else {
                printResponse(["ok": false, "error": "Missing 'text'"])
                continue
            }
            let res = session.typeText(text: text)
            printResponse(["ok": res.ok, "error": res.error as Any])
            
        case "press_key":
            guard let key = json["key"] as? String else {
                printResponse(["ok": false, "error": "Missing 'key'"])
                continue
            }
            let res = session.pressKey(key: key)
            printResponse(["ok": res.ok, "error": res.error as Any])
            
        case "scroll":
            let index = json["index"] as? Int
            let dir = (json["direction"] as? String) ?? "down"
            let pages = (json["pages"] as? Int) ?? 1
            let res = session.scroll(index: index, direction: dir, pages: pages)
            printResponse(["ok": res.ok, "error": res.error as Any])
            
        case "drag":
            guard let fromArr = json["from"] as? [Double], fromArr.count >= 2,
                  let toArr = json["to"] as? [Double], toArr.count >= 2 else {
                printResponse(["ok": false, "error": "Missing 'from' or 'to' coordinates"])
                continue
            }
            let res = session.drag(from: CGPoint(x: fromArr[0], y: fromArr[1]), to: CGPoint(x: toArr[0], y: toArr[1]))
            printResponse(["ok": res.ok, "error": res.error as Any])
            
        case "quit":
            printResponse(["ok": true, "message": "Bye"])
            exit(0)
            
        default:
            printResponse(["ok": false, "error": "Unknown command: \(cmd)"])
        }
    }
}

func printResponse(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
       let str = String(data: data, encoding: .utf8) {
        print(str)
        fflush(stdout)
    }
}

// MARK: - Main Entry Point

let args = CommandLine.arguments

if args.contains("daemon") || args.contains("--daemon") {
    runDaemon()
} else if args.contains("is-trusted") || args.contains("--is-trusted") {
    let trusted = AXIsProcessTrusted()
    print(trusted ? "true" : "false")
    exit(trusted ? 0 : 1)
} else if args.contains("apps") || args.contains("--apps") {
    let apps = NSWorkspace.shared.runningApplications
        .filter { $0.activationPolicy == .regular }
        .compactMap { $0.localizedName }
        .sorted()
    for app in apps {
        print(app)
    }
} else if let obsIdx = args.firstIndex(of: "observe"), obsIdx + 1 < args.count {
    let appName = args[obsIdx + 1]
    let session = AXSession.shared
    let bindRes = session.bind(appName: appName)
    if !bindRes.ok {
        fputs("Error: \(bindRes.message)\n", stderr)
        exit(1)
    }
    let res = session.observe()
    if res.ok {
        print(res.axText)
    } else {
        fputs("Error: \(res.error ?? "Failed")\n", stderr)
        exit(1)
    }
} else {
    print("""
    mac-ax: macOS Accessibility Driver for Jev-cu / Antigravity
    
    Usage:
      mac-ax daemon                  Run JSON-RPC daemon over stdin/stdout
      mac-ax is-trusted              Check accessibility permissions
      mac-ax apps                    List running regular applications
      mac-ax observe <AppName>       Dump AX tree for application
    """)
}
