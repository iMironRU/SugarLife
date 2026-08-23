import Foundation
import AVFoundation
import MediaPlayer
import UIKit

/**
 ГРОМКОСТЬ НА ВРЕМЯ ТРЕВОГИ (SugarLife#482).

 Свой звук пробивает беззвучный режим, но не убавленную громкость: играем мы на общем уровне медиа, и
 если вечером слушали подкаст на четверти громкости, ночная тревога прозвучит на четверти громкости.
 Человек при этом уверен, что защита включена, — приложение ведь сказало «разбудим».

 Официального способа менять системный уровень нет: `outputVolume` только читается. Рабочий приём —
 ползунок внутри `MPVolumeView`: вид публичный, значение ползунка и есть системная громкость. Так же
 это делают xDrip4iOS и Loop. В App Store с таким не пускают, но мы туда и не идём (наружу нативка не
 выкладывается вовсе), а цена ошибки на другой чаше — непрозвучавшая ночная тревога.

 ГРОМКОСТЬ ВОЗВРАЩАЕМ. Поднять и забыть — значит утром включить музыку на полной громкости в наушниках.
 Прежний уровень запоминаем до подъёма и ставим обратно, когда тревога смолкла.

 ЭТО ВЫБОР ЧЕЛОВЕКА, но умолчание другое, чем у фонового бодрствования: там платой была батарея, здесь
 платы нет вовсе — громкость меняется на секунды и возвращается. Поэтому по умолчанию включено.
 */
final class Громкость {

    static let общая = Громкость()

    private let ключ = "sugarlife.alarm-volume-boost"
    private var было: Float?

    private init() {
        if UserDefaults.standard.object(forKey: ключ) == nil {
            UserDefaults.standard.set(true, forKey: ключ)
        }
    }

    /// Поднимаем ли громкость на будящей тревоге.
    var поднимаем: Bool {
        get { UserDefaults.standard.bool(forKey: ключ) }
        set { UserDefaults.standard.set(newValue, forKey: ключ) }
    }

    /// Системная громкость сейчас, 0…1. По ней экран говорит, услышат ли тревогу.
    var сейчас: Float { AVAudioSession.sharedInstance().outputVolume }

    /// Поднять до предела, запомнив прежний уровень. Повторный вызов ничего не портит.
    func поднять() {
        guard поднимаем, было == nil else { return }
        было = сейчас
        выставить(1.0)
    }

    /// Вернуть прежний уровень. Если не поднимали — молчим.
    func вернуть() {
        guard let прежняя = было else { return }
        было = nil
        выставить(прежняя)
    }

    private func выставить(_ уровень: Float) {
        DispatchQueue.main.async {
            /* Вид должен быть в живой иерархии окон, иначе ползунка внутри просто нет. Держим его
               размером в точку и прозрачным: показывать системный регулятор мы не собираемся. */
            let окно = UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
            let вид = MPVolumeView(frame: CGRect(x: -100, y: -100, width: 1, height: 1))
            вид.alpha = 0.0001
            окно?.addSubview(вид)
            /* Ползунок появляется не мгновенно: MPVolumeView собирает своё содержимое асинхронно, и
               сразу после добавления subviews у него пустые. */
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                if let ползунок = вид.subviews.compactMap({ $0 as? UISlider }).first {
                    ползунок.setValue(уровень, animated: false)
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { вид.removeFromSuperview() }
            }
        }
    }
}
