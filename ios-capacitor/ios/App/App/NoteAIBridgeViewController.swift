import UIKit
import WebKit
import Capacitor

private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?

    init(delegate: WKScriptMessageHandler) {
        self.delegate = delegate
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

final class NoteAIBridgeViewController: CAPBridgeViewController, WKScriptMessageHandler {
    private static let messageHandlerName = "noteaiMarkdownToolbar"
    private static let commandEventName = "noteai:native-markdown-command"

    private let toolbarHost = UIView()
    private let toolbar = UIView()
    private let toolbarStack = UIStackView()
    private var imageButton: UIButton?
    private var messageHandler: WeakScriptMessageHandler?
    private var toolbarShouldBeVisible = false
    private var writeModeEnabled = false
    private var keyboardVisible = false

    override func viewDidLoad() {
        super.viewDidLoad()
        installMarkdownToolbar()
        installMessageHandler()
        installKeyboardObservers()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: Self.messageHandlerName)
    }

    private func installKeyboardObservers() {
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillShow), name: UIResponder.keyboardWillShowNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillHide), name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    @objc private func keyboardWillShow(_ notification: Notification) {
        keyboardVisible = true
        refreshToolbarVisibility()
    }

    @objc private func keyboardWillHide(_ notification: Notification) {
        keyboardVisible = false
        refreshToolbarVisibility()
    }

    private func installMessageHandler() {
        guard let webView else { return }
        let handler = WeakScriptMessageHandler(delegate: self)
        messageHandler = handler
        webView.configuration.userContentController.add(handler, name: Self.messageHandlerName)
    }

    private func installMarkdownToolbar() {
        view.backgroundColor = .systemBackground
        webView?.isOpaque = false
        webView?.backgroundColor = .systemBackground
        webView?.scrollView.backgroundColor = .systemBackground

        toolbarHost.translatesAutoresizingMaskIntoConstraints = false
        toolbarHost.isHidden = true
        toolbarHost.alpha = 0
        toolbarHost.backgroundColor = .clear
        toolbarHost.accessibilityViewIsModal = false

        toolbar.translatesAutoresizingMaskIntoConstraints = false
        toolbar.backgroundColor = .white
        toolbar.layer.cornerRadius = 16
        toolbar.layer.cornerCurve = .continuous
        toolbar.layer.shadowColor = UIColor.black.cgColor
        toolbar.layer.shadowOpacity = 0.09
        toolbar.layer.shadowRadius = 6
        toolbar.layer.shadowOffset = CGSize(width: 0, height: 1)
        toolbar.clipsToBounds = false
        toolbarHost.addSubview(toolbar)

        toolbarStack.translatesAutoresizingMaskIntoConstraints = false
        toolbarStack.axis = .horizontal
        toolbarStack.alignment = .center
        toolbarStack.distribution = .fillEqually
        toolbarStack.spacing = 0
        toolbar.addSubview(toolbarStack)

        toolbarStack.addArrangedSubview(makeHeadingButton())
        toolbarStack.addArrangedSubview(makeButton(symbol: "bold", label: "加粗", command: ["type": "bold"]))
        toolbarStack.addArrangedSubview(makeButton(symbol: "link", label: "插入链接", command: ["type": "link"]))
        toolbarStack.addArrangedSubview(makeButton(symbol: "text.quote", label: "引用", command: ["type": "quote"]))
        toolbarStack.addArrangedSubview(makeButton(symbol: "list.bullet", label: "无序列表", command: ["type": "unordered-list"]))
        toolbarStack.addArrangedSubview(makeButton(symbol: "chevron.left.forwardslash.chevron.right", label: "行内代码", command: ["type": "inline-code"]))

        let imageButton = makeButton(symbol: "photo.badge.plus", label: "上传图片", command: ["type": "image"])
        self.imageButton = imageButton
        toolbarStack.addArrangedSubview(imageButton)

        view.addSubview(toolbarHost)
        view.keyboardLayoutGuide.followsUndockedKeyboard = false
        NSLayoutConstraint.activate([
            toolbarHost.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            toolbarHost.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            toolbarHost.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            toolbarHost.heightAnchor.constraint(equalToConstant: 58),

            toolbar.leadingAnchor.constraint(equalTo: toolbarHost.leadingAnchor, constant: 4),
            toolbar.trailingAnchor.constraint(equalTo: toolbarHost.trailingAnchor, constant: -4),
            toolbar.topAnchor.constraint(equalTo: toolbarHost.topAnchor, constant: 4),
            toolbar.bottomAnchor.constraint(equalTo: toolbarHost.bottomAnchor, constant: -4),

            toolbarStack.leadingAnchor.constraint(equalTo: toolbar.leadingAnchor),
            toolbarStack.trailingAnchor.constraint(equalTo: toolbar.trailingAnchor),
            toolbarStack.topAnchor.constraint(equalTo: toolbar.topAnchor),
            toolbarStack.bottomAnchor.constraint(equalTo: toolbar.bottomAnchor),
        ])
    }

    private func makeHeadingButton() -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.plain()
        configuration.title = "H"
        configuration.image = UIImage(systemName: "chevron.down")
        configuration.imagePlacement = .trailing
        configuration.imagePadding = 2
        configuration.contentInsets = .zero
        configuration.baseForegroundColor = UIColor.label.withAlphaComponent(0.82)
        configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 9, weight: .regular)
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
            var result = attributes
            result.font = .systemFont(ofSize: 18, weight: .regular)
            return result
        }
        button.configuration = configuration
        button.accessibilityLabel = "选择标题级别"
        button.showsMenuAsPrimaryAction = true
        button.menu = UIMenu(title: "标题级别", children: (1...4).map { level in
            UIAction(title: ["一级标题", "二级标题", "三级标题", "四级标题"][level - 1]) { [weak self] _ in
                self?.dispatch(command: ["type": "heading", "level": level])
            }
        })
        constrainButton(button)
        return button
    }

    private func makeButton(symbol: String, label: String, command: [String: Any]) -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.plain()
        configuration.image = UIImage(systemName: symbol)
        configuration.contentInsets = .zero
        configuration.baseForegroundColor = UIColor.label.withAlphaComponent(0.82)
        configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 18, weight: .regular)
        button.configuration = configuration
        button.accessibilityLabel = label
        button.addAction(UIAction { [weak self] _ in self?.dispatch(command: command) }, for: .touchUpInside)
        constrainButton(button)
        return button
    }

    private func constrainButton(_ button: UIButton) {
        button.translatesAutoresizingMaskIntoConstraints = false
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    }

    private func dispatch(command: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(command),
              let data = try? JSONSerialization.data(withJSONObject: command),
              let payload = String(data: data, encoding: .utf8) else { return }
        let script = "window.dispatchEvent(new CustomEvent('\(Self.commandEventName)', { detail: \(payload) }));"
        webView?.evaluateJavaScript(script)
    }

    private func updateToolbar(writeModeEnabled: Bool?, uploading: Bool?) {
        if let uploading, let imageButton {
            imageButton.isEnabled = !uploading
            var configuration = imageButton.configuration
            configuration?.showsActivityIndicator = uploading
            configuration?.image = uploading ? nil : UIImage(systemName: "photo.badge.plus")
            imageButton.configuration = configuration
            imageButton.accessibilityLabel = uploading ? "正在上传图片" : "上传图片"
        }

        if let writeModeEnabled {
            self.writeModeEnabled = writeModeEnabled
        }
        refreshToolbarVisibility()
    }

    private func refreshToolbarVisibility() {
        let visible = writeModeEnabled && keyboardVisible
        let visibilityChanged = visible != toolbarShouldBeVisible
        toolbarShouldBeVisible = visible
        guard visibilityChanged else { return }
        if visible {
            toolbarHost.isHidden = false
            let duration = UIAccessibility.isReduceMotionEnabled ? 0 : 0.16
            UIView.animate(withDuration: duration, delay: 0, options: [.curveEaseOut, .beginFromCurrentState]) {
                self.toolbarHost.alpha = 1
            }
        } else {
            let duration = UIAccessibility.isReduceMotionEnabled ? 0 : 0.12
            UIView.animate(withDuration: duration, delay: 0, options: [.curveEaseIn, .beginFromCurrentState]) {
                self.toolbarHost.alpha = 0
            } completion: { _ in
                if !self.toolbarShouldBeVisible {
                    self.toolbarHost.isHidden = true
                }
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.messageHandlerName,
              let body = message.body as? [String: Any],
              body["type"] as? String == "state" else { return }
        updateToolbar(writeModeEnabled: body["visible"] as? Bool, uploading: body["uploading"] as? Bool)
    }
}
