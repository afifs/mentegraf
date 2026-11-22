---
mentegraf-node: ch04
---

# Metin bölmesi

Haritadaki **her düğümün bir metni olabilir**: bir bölümün tam metni, bir kişi hakkındaki notlar, bir kavramın tanımı. Düğüm panelindeki **Metin oluştur** düğmesi düğüm için yeni bir Markdown dosyası açar; metni olan düğümlerde aynı düğme **Metni aç** olur. Bölüm türündeki düğümlerin metinleri `manuscript/`, diğerleri `notes/` klasörüne yazılır.

![Metin bölmesi ve araç çubuğu](../assets/metin-bolmesi.png){#fig:metin-bolmesi}

Metin bölmesi haritanın sağında açılır (@fig:metin-bolmesi). Kenarından sürükleyerek genişletebilir, ⤢ ile tam genişliğe alabilirsiniz. Alt çubukta kelime sayısı ve kaydedilmemiş değişiklik uyarısı görünür. Metinler projeyle birlikte Ctrl+S ile kaydedilir.

## Markdown, ama görünmeden

Metin Markdown olarak saklanır ve öyle görünür: `#`, `**`, `_` gibi işaretler yerinde durur, ama başlıklar büyük, vurgular kalın ya da italik, dipnot ve atıf işaretleri renkli gösterilir. Böylece metnin ne olduğunu her zaman görürsünüz; dışa aktarımda bir sürpriz olmaz. WYSIWYG bir editör yoktur; işaretleri araç çubuğu ve kısayollar sizin yerinize koyar:

| Düğme | Kısayol | İş |
|---|---|---|
| **B** | Ctrl+B | kalın |
| *I* | Ctrl+I | italik |
| H | | başlık düzeyi |
| ❝ | | alıntı |
| • / 1. | | madde ya da numaralı liste (seçili birden çok satıra birlikte) |
| bağlantı | Ctrl+K | bağlantı |
| ¹ | Ctrl+Shift+F | dipnot |
| @ | Ctrl+Shift+C | atıf (Zotero) |
| ¶ | Ctrl+Shift+P | pasaj kimliği |
| görsel | Ctrl+Shift+G | şekil ya da tablo |
| iddia | Ctrl+Shift+K / U / T | iddia, soru, görev |
| göz | Ctrl+E | önizleme |

## Yazım denetimi

Mentegraf yazarken yazım yanlışlarının altını çizer. Denetim yalnızca metin bölmesinde yapılır (dipnotlar ve şekil alt yazıları dahil); düğüm adları, dosya adları, web adresleri, dipnot ve atıf işaretleri, pasaj kimlikleri ve `{…}` blokları denetlenmez.

- **Dil** menülerin dili değil, kitabın dilidir (Ayarlar → belge dili). Türkçe bir kitap Türkçe ve İngilizce birlikte denetlenir; böylece metindeki İngilizce terimler yanlış görünmez.
- **Görünüm → Yazım denetimi** denetimi açıp kapatır. Varsayılanı açıktır; seçim projeye yazılır.
- Altı çizili sözcüğe **sağ tıklayınca** öneriler çıkar; birini seçmek sözcüğü düzeltir. Aynı menüde:
  - **Sözlüğe ekle**: sözcük doğrudur, denetleyici bilmiyor. Projenin sözlüğüne yazılır: `.mentegraf/dictionary.txt`.
  - **Bu projede yok say**: sözcük bu kitapta doğrudur ama genel bir sözcük değildir (bir ad, bir alıntı). `.mentegraf/ignore.txt` dosyasına yazılır.
  - **Kes / Kopyala / Yapıştır**.
- İki dosya da düz metindir, satır başına bir sözcük; `#` ile başlayan satırlar açıklamadır. Elle de düzenlenebilirler. Proje klasöründe durdukları için kitapla birlikte taşınır ve Seafile gibi eşitleme araçlarıyla öbür bilgisayarlara gider. Bir projenin sözcükleri yalnızca o proje açıkken geçerlidir.
- Projeyi ilk kez kaydetmeden önce sözlüğe sözcük eklenemez; sözlük proje klasöründe tutulur.

**Windows ve Linux:** Denetim Chromium'un Hunspell sözlükleriyle yapılır. Türkçe ve İngilizce sözlükler ilk kullanımda bir kez Google'ın sunucusundan indirilir; bu yüzden ilk açılışta internet bağlantısı gerekir. Metniniz hiçbir yere gönderilmez, yalnızca sözlük dosyaları indirilir.

**macOS:** Sistemin kendi denetleyicisi çalışır ve dil seçimi uygulamadan yönetilemez; macOS metnin dilini kendisi tanır ya da *Sistem Ayarları → Klavye → Metin girişi*'nde seçilen dilleri kullanır. "Sözlüğe ekle" ile eklenen sözcükler sistemin sözlüğüne de gider ve proje kapanınca orada kalır.


Göz düğmesi (Ctrl+E) metni dizgi hâlinde gösterir: dipnotlar sayfa altında, şekiller numaralı başlıklarıyla, şekil atıfları "Şekil 3" olarak. Önizleme salt okunurdur; yazmaya dönmek için yeniden basın.

## Dışarıda düzenlemek

Metin dosyası Typora ya da Obsidian'da açıkken değiştirilirse Mentegraf bunu fark eder: metin bölmesinde açıksa yeni hâlini yükler, sizin kaydedilmemiş değişikliğiniz varsa ne yapacağınızı sorar. Bu sayede Mentegraf'ı yalnızca haritayı yönetmek için kullanıp yazmayı alıştığınız editörde sürdürebilirsiniz. ^disari

## Tek metni Word'e aktarmak

Araç çubuğundaki **DOCX** düğmesi açık metni Pandoc ile Word belgesine dönüştürür: dipnotlar gerçek Word dipnotu, atıflar seçtiğiniz stile göre biçimlenmiş, kaynakça en sonda. Bütün kitabı derlemek için *Derleme* bölümüne bakın.
