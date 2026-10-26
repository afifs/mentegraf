---
mentegraf-node: ch02
---

# Proje klasörü ve kaydetme

## Yeni proje, açma, kaydetme

**Dosya → Yeni proje** boş bir harita açar. İlk kez **Kaydet** (Ctrl+S) dediğinizde Mentegraf bir klasör adı sorar ve projeyi o klasöre yazar. Sonraki kayıtlar aynı klasöre gider; yalnızca değişen dosyalar yeniden yazılır.

**Dosya → Aç** ile bir proje klasöründeki `project.mentegraf` dosyasını seçersiniz. Eski, tek dosyalı `.mentegraf` ve `.json` projeleri de açılır: Mentegraf bunları yeni klasör biçimine dönüştürüp bir kopya oluşturur, orijinal dosyaya dokunmaz.

## Klasörün içi

```
Kitabım/
  project.mentegraf      ayarlar, düğüm ve bağlantı türleri, dışa aktarma ayarları
  graph/nodes/           her düğüm için bir .json dosyası
  graph/edges.json       bağlantılar
  graph/layout.json      düğümlerin haritadaki yerleri
  graph/manuscript.json  kitap planı
  graph/categories.json  kategori ağacı
  manuscript/            bölüm metinleri (Markdown)
  notes/                 diğer düğümlerin metinleri
  assets/                şekiller ve CSV tablolar
  exports/               derlenmiş kitaplar
  .mentegraf/backups/    otomatik yedekler
```

Bu düzen bilinçli olarak basittir: her şey düz metin, her dosya küçük. Bir eşitleme aracı (ör. Seafile) iki bilgisayar arasında yalnızca değişen dosyaları taşır; iki ayrı değişiklik çakışırsa çakışma kopyası Mentegraf tarafından açılışta bildirilir.

## Güvenlik ağı

Mentegraf veri kaybına karşı üç katman tutar:

- **Güvenli yazma.** Her dosya önce geçici bir dosyaya yazılır, sonra eskisinin yerine konur; yazma sırasında elektrik kesilse bile yarım dosya kalmaz.
- **Yedekler.** Her kayıtta haritanın bir yedeği `.mentegraf/backups` klasörüne alınır; bir metin üzerine yazılmadan önce eski hâlinin son beş sürümü saklanır.
- **Kurtarma.** Kaydedilmemiş değişiklikler 30 saniyede bir ayrı bir kurtarma dosyasına yazılır. Program beklenmedik biçimde kapanırsa bir sonraki açılışta bu değişiklikleri geri yüklemeyi önerir.

Kaydedilmemiş değişiklik varken programı kapatmaya çalışırsanız Mentegraf sorar; metin bölmesinin alt çubuğunda "kaydedilmedi" yazısı da aynı durumu gösterir.

## Ayarlar

⚙ düğmesi ayarları açar. Burada düğüm türlerini (renk, ad, simge), bağlantı türlerini ve dışa aktarma ayarlarını (atıf stili, Word şablonu, belge dili) düzenlersiniz. Bu ayarlar projeye kaydedilir; her kitap kendi türlerini ve stilini taşır.
