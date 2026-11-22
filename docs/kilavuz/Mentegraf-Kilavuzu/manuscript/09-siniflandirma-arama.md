---
mentegraf-node: ch09
---

# Sınıflandırma ve arama

## Kategoriler

Düğüm türü bir şeyin *ne olduğunu* söyler (kişi, kavram, kitap). **Kategori** ise sizin kendi konu ağacınızda *nerede durduğunu*: "Sibernetik › Geri besleme" gibi. Bir düğüm birden çok kategoride olabilir; bir düğümün metni de düğümünün kategorilerini taşır.

![Sınıflandırma bölmesi: kategori ağacı, etiketler ve süzülmüş düğümler](../assets/siniflandirma.png){#fig:siniflandirma}

Sol araç çubuğundaki **Sınıflandırma** düğmesi bölmeyi açar (@fig:siniflandirma). Ağaç istediğiniz kadar derin olabilir; ilk iki düzey açık gelir, daha derin dallar ▸ ile açılır.

- **+ Kategori** en üst düzeye, satırın üzerindeki **+** alt kategori ekler.
- Çift tıklama yeniden adlandırır; sürükleyip bırakmak taşır.
- Sayılar alt kategorileri de içerir.
- Kullanılan bir kategoriyi silerken Mentegraf sorar; alt kategoriler bir üst düzeye taşınır.

Düğüme kategori vermek için düğüm panelindeki **Kategoriler** alanına adın bir kısmını yazın ve öneriyi seçin. Hiçbir kategori eşleşmezse Enter yeni bir kategori oluşturur.

## Etiketler

Etiketler düz, geçici işaretlerdir: `doğrulanacak`, `bölüm3-taslak` gibi. Düğüm panelinde virgülle ayrılarak yazılır, Sınıflandırma bölmesinde sayılarıyla listelenir.

## Filtre (mercek)

Bir kategoriye ya da etikete tıklamak **filtreyi** açar ve her yerde etkisini gösterir:

- Haritada eşleşmeyen her şey solar.
- Kitap planında dışarıda kalan bölümler sönükleşir.
- Bölmenin altında eşleşen düğümler listelenir; ✎ metni olanları gösterir.
- Açık metinde, eşleşen düğümlerin adının geçtiği satırlar ve bu kategorideki iddiaların paragrafları vurgulanır.

Aynı kategoriye yeniden tıklamak ya da **Filtreyi kaldır** filtreyi kapatır.

## Metinlerde arama

![Metinlerde arama](../assets/arama.png){#fig:arama}

**Ctrl+Shift+H** ya da bölmenin üstündeki kutu, projedeki bütün metinlerde arar (@fig:arama): `manuscript/` ve `notes/` klasörleri, kaydedilmemiş değişiklikler dahil.

- Varsayılan arama esnektir: büyük-küçük harf ve aksan fark etmez; "dusunme" "Düşünme"yi, "kar" "kâr"ı bulur; ı/i/I/İ aynı harf sayılır.
- **Harfleri tam eşle** kutusu bunu kapatır: büyük-küçük harf, şapka ve Türkçe harfler ayırt edilir. "kâr" yalnızca "kâr"ı, "kar" yalnızca "kar"ı bulur.
- **Bütün sözcük** kutusu, sözcüğün bir parçası olarak geçenleri saymaz: "kar" artık "karmaşık"ı bulmaz. Türkçe harfler sözcük harfi sayılır; kesme işareti ve tire sözcüğü bitirir, yani "Ankara" "Ankara'da"yı bulur. İki kutu birlikte de, ayrı ayrı da çalışır.
- Aradığınız metin olduğu gibi aranır: başına ya da sonuna koyduğunuz boşluk aramanın bir parçasıdır ("kar " yalnızca boşlukla biten "kar"ı bulur).
- Kutular projenin varsayılanlarıyla açılır ve yalnızca o aramayı değiştirir. Seçiminiz varsayılandan farklıysa yanlarında **Varsayılan yap** bağlantısı görünür; tıklamak seçimi projeye yazar (`project.mentegraf` → `settings.search`), proje kaydedilince kalıcı olur.
- Dipnotlar ve şekil alt yazıları da aranır; sonuç satırında **dipnot** ya da **alt yazı** etiketi nerede bulunduğunu söyler. Görselin dosya adı ve `#fig:` kimliği aranmaz.
- Sonuçlar metin metin gruplanır; bir satıra tıklamak metni açar ve bulunan kelimeyi seçer.
- Filtre açıkken arama yalnızca filtredeki metinlerde yapılır; "Yalnızca filtredeki metinler" kutusu bunu açıp kapatır.
- Bir düğüm seçiliyken sonuçlardaki **Bağla** düğmesi o metnin düğümünü seçili düğüme bağlar: arama yaparken haritayı da kurarsınız.
- Editörde seçili kelimeler varsa Ctrl+Shift+H onları arar.
