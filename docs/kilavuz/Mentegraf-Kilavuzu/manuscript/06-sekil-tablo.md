---
mentegraf-node: ch06
---

# Şekiller ve tablolar

Bir görsel ya da tablo metne hangi yoldan girerse girsin, Mentegraf onu haritada bir **Şekil** ya da **Tablo** düğümüne dönüştürür. Böylece bir şeklin hangi bölümlerde kullanıldığı, hangi kavramlarla ilgili olduğu da haritanın parçası olur.

## Eklemenin üç yolu

- **Yapıştırmak:** bir ekran görüntüsünü ya da kopyalanmış bir görseli metne yapıştırın (Ctrl+V).
- **Sürükleyip bırakmak:** bir görsel ya da CSV dosyasını metnin üzerine bırakın.
- **Seçici:** araç çubuğundaki görsel düğmesi (Ctrl+Shift+G) mevcut şekil ve tabloları listeler; aranabilir. Her satırda iki düğme vardır: **Ekle** şekli imlecin olduğu yere koyar, **Atıf** ona bir atıf yazar. Alttaki düğmelerle yeni görsel ya da CSV seçebilirsiniz.

Her yolda dosya projenin `assets/` klasörüne kopyalanır, düğüm metnin düğümüne bağlanır ve metne standart Markdown yazılır:

```
![Libet deneyi](../assets/sekil-1-libet-deneyi.png){#fig:libet}
```

Haritada kendiniz bir düğüm oluşturup türünü Şekil ya da Tablo yaparsanız, düğüm panelinde dosya seçme düğmesi belirir; dosyası olan düğümlerde **Değiştir** ile görsel yenilenir.

## Numaralama ve atıf

Şekil ve tablolara numara vermezsiniz; Mentegraf dışa aktarırken bunları kitap boyunca sırayla numaralar ("Şekil 1", "Şekil 2"…). Metinde bir şekle atıf yapmak için `@fig:libet` (tablolar için `@tbl:…`) yazarsınız; dışa aktarımda bu "Şekil 4" gibi doğru numaraya dönüşür. Önizleme de numaraları ve görselleri gösterir.

CSV dosyaları dışa aktarımda gerçek Word ya da EPUB tablosuna dönüşür; başlığı "Tablo N." olarak yazılır. Bulunamayan bir atıf "??" olarak görünür ve uyarı verilir.
