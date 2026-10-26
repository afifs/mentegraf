---
mentegraf-node: ch08
---

# Derleme ve dışa aktarım

## Kitabı derlemek

Kitap planındaki **Derle ▾** düğmesi üç biçim sunar: **Word (DOCX)**, **E-kitap (EPUB)** ve **tek Markdown dosyası**. Mentegraf, plana dahil olan bölümleri sırayla birleştirir:

- Kısım başlıkları birinci düzey, bölümler ikinci, alt bölümler üçüncü düzey başlık olur; metinlerin içindeki başlıklar buna göre kaydırılır.
- Her bölümün dipnotları ayrı tutulur ve birbirine karışmaz.
- Henüz kaydedilmemiş değişiklikler de derlemeye girer.
- Metni olmayan bölümler yalnızca başlıklarıyla yer alır ve size bildirilir.

Sonuç `exports/` klasörüne yazılır. Word ve EPUB için bilgisayarınızda **Pandoc** (2.17 ya da daha yeni) kurulu olmalıdır.

## Stil ve şablon

Ayarlar → Dışa aktarma bölümünden üç şey seçilir:

- **Atıf stili** (APA, Chicago… ya da Zotero'dan bir stil),
- **Word şablonu** (başlık, gövde ve dipnot biçimlerini belirleyen bir `reference.docx`),
- **Belge dili** (Türkçe ya da İngilizce; "Şekil/Figure", "Kaynakça/References" gibi sözcükleri de belirler).

Bu ayarlar projeye kaydedilir; aynı kitap her bilgisayarda aynı biçimde çıkar.

## Haritayı dışa aktarmak

Sol araç çubuğundaki dışa aktar düğmesi haritanın kendisi için başka biçimler sunar:

- **JSON** — projenin tamamı tek dosyada; tekrar içe aktarılabilir.
- **HTML (yayın)** — etkileşimli, paylaşılabilir bir web sayfası.
- **Obsidian kasası** — her düğüm bir Markdown dosyası, bağlantılar wiki bağlantısı olarak.
- **SVG** — baskı kalitesinde vektör görsel.
- **CSV** — düğüm ve bağlantı tabloları.
- **Tür raporu** — seçtiğiniz düğüm türlerinin açıklama, not ve bağlantıları.

## Zotero'dan içe aktarmak

**Z** düğmesi Zotero kütüphanenizden kitap ve makaleleri haritaya getirir. Yazarlar otomatik olarak kişi düğümü olur ve esere bağlanır; içe aktarılan düğümün panelinde "Zotero'da aç" düğmesi belirir.
