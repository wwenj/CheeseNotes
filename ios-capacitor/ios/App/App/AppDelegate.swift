import UIKit
import Capacitor
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var hasPresentedBrandSplash = false
    private var brandSplash: UIView?
    private var webViewLoadObservation: NSKeyValueObservation?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        DispatchQueue.main.async { [weak self] in
            self?.presentBrandSplashIfNeeded()
        }
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        presentBrandSplashIfNeeded()
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    private func presentBrandSplashIfNeeded() {
        guard !hasPresentedBrandSplash, let window else { return }
        hasPresentedBrandSplash = true

        let splash = UIView()
        splash.translatesAutoresizingMaskIntoConstraints = false
        splash.backgroundColor = .white
        splash.accessibilityViewIsModal = true

        let logo = UIImageView(image: UIImage(named: "CheeseLaunchSplash"))
        logo.translatesAutoresizingMaskIntoConstraints = false
        logo.contentMode = .scaleAspectFit
        logo.accessibilityLabel = "芝士"

        let name = makeLabel("芝士", size: 36, weight: .heavy, color: UIColor(red: 55 / 255, green: 45 / 255, blue: 22 / 255, alpha: 1))
        let tagline = makeLabel("知识有味，笔记有序", size: 17, weight: .semibold, color: UIColor(red: 115 / 255, green: 95 / 255, blue: 61 / 255, alpha: 1))
        let detail = makeLabel("本地优先 · GitHub 同步", size: 13, weight: .regular, color: UIColor(red: 154 / 255, green: 137 / 255, blue: 95 / 255, alpha: 1))

        let content = UIStackView(arrangedSubviews: [logo, name, tagline, detail])
        content.translatesAutoresizingMaskIntoConstraints = false
        content.axis = .vertical
        content.alignment = .center
        content.spacing = 12
        content.setCustomSpacing(26, after: logo)
        content.setCustomSpacing(14, after: name)

        splash.addSubview(content)
        window.addSubview(splash)
        NSLayoutConstraint.activate([
            splash.leadingAnchor.constraint(equalTo: window.leadingAnchor),
            splash.trailingAnchor.constraint(equalTo: window.trailingAnchor),
            splash.topAnchor.constraint(equalTo: window.topAnchor),
            splash.bottomAnchor.constraint(equalTo: window.bottomAnchor),
            logo.widthAnchor.constraint(equalToConstant: 178),
            logo.heightAnchor.constraint(equalToConstant: 178),
            content.centerXAnchor.constraint(equalTo: splash.centerXAnchor),
            content.centerYAnchor.constraint(equalTo: splash.centerYAnchor, constant: -26),
            content.leadingAnchor.constraint(greaterThanOrEqualTo: splash.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            content.trailingAnchor.constraint(lessThanOrEqualTo: splash.safeAreaLayoutGuide.trailingAnchor, constant: -24),
        ])

        brandSplash = splash
        dismissSplashWhenWebAppIsReady()
    }

    private func dismissSplashWhenWebAppIsReady() {
        guard let bridgeViewController = window?.rootViewController as? CAPBridgeViewController,
              let webView = bridgeViewController.webView else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                self?.dismissSplashWhenWebAppIsReady()
            }
            return
        }

        webViewLoadObservation = webView.observe(\.isLoading, options: [.initial, .new]) { [weak self, weak webView] _, change in
            guard change.newValue == false, let webView, webView.url != nil else { return }
            DispatchQueue.main.async {
                self?.dismissSplashWhenRootContentIsVisible(in: webView)
            }
        }
    }

    private func dismissSplashWhenRootContentIsVisible(in webView: WKWebView) {
        guard brandSplash != nil else { return }

        webView.evaluateJavaScript("document.readyState === 'complete' && document.getElementById('root')?.childElementCount > 0") { [weak self, weak webView] result, _ in
            guard let self, let webView, self.brandSplash != nil else { return }

            if (result as? NSNumber)?.boolValue == true {
                self.dismissBrandSplash()
                return
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self, weak webView] in
                guard let self, let webView else { return }
                self.dismissSplashWhenRootContentIsVisible(in: webView)
            }
        }
    }

    private func dismissBrandSplash() {
        guard let splash = brandSplash else { return }
        brandSplash = nil
        webViewLoadObservation = nil

        UIView.animate(withDuration: 0.18, delay: 0, options: .curveEaseIn) {
            splash.alpha = 0
        } completion: { _ in
            splash.removeFromSuperview()
        }
    }

    private func makeLabel(_ text: String, size: CGFloat, weight: UIFont.Weight, color: UIColor) -> UILabel {
        let label = UILabel()
        label.text = text
        label.textColor = color
        label.font = .systemFont(ofSize: size, weight: weight)
        label.textAlignment = .center
        label.adjustsFontForContentSizeCategory = true
        return label
    }
}
