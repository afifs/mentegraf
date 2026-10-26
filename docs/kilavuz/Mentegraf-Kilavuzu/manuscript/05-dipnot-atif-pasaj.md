---
mentegraf-node: ch05
---

# Dipnot, atıf ve pasaj

## Dipnot

¹ düğmesi (Ctrl+Shift+F) imlecin olduğu yere bir dipnot işareti koyar ve paragrafın altına dipnotun metnini yazacağınız satırı açar:

```
Wiener geri beslemeyi tanımladı.[^sibernetik-1]

[^sibernetik-1]: Wiener, 1948.
```

Dipnot etiketleri numara değil, metnin adından türetilen addır. Bu sayede bölümleri yer değiştirdiğinizde ya da bir bölümü başka bir kitaba taşıdığınızda dipnotlar karışmaz; kitap derlenirken her bölümün etiketleri ayrıca öneklenir ve Word'de doğru sırayla numaralanır.

## Atıf

@ düğmesi (Ctrl+Shift+C) Zotero'nun kaynak seçicisini açar; seçtiğiniz kaynak `[@wiener1948]` biçiminde eklenir. Bunun için Zotero'da **Better BibTeX** eklentisinin kurulu ve Zotero'nun açık olması gerekir. Zotero kapalıysa Mentegraf atıf anahtarını elle yazmanıza izin verir.

Dışa aktarırken atıflar seçtiğiniz **atıf stiline** (CSL) göre biçimlenir ve kaynakça otomatik eklenir. Stil, Ayarlar → Dışa aktarma bölümünden seçilir: projeye bir `.csl` dosyası içe aktarabilir ya da Zotero'da kurulu stillerden birini seçebilirsiniz.

## Pasaj

Bir **pasaj**, bir metnin içinde adresi olan bir bloktur: çoğunlukla bir paragraf, bazen bir alıntı ya da liste. ¶ düğmesi (Ctrl+Shift+P) imlecin bulunduğu paragrafın sonuna kısa bir kimlik ekler:

```
Sıçrama tasarlanamaz ama hazırlanabilir. ^k3x9pa
```

ve bu pasajın adresini (`manuscript/bukulen-ayna.md#k3x9pa`) panoya kopyalar. Kimlikler metinde soluk görünür, dışa aktarımda tamamen silinir.

Pasaj kimliklerini çoğu zaman elle eklemeniz gerekmez: bir iddia, soru ya da görev yakaladığınızda Mentegraf paragrafa kimliği kendisi verir (bkz. *Argüman katmanı*). Bir paragrafın zaten kimliği varsa yenisi eklenmez, mevcut olan kullanılır. ^pasaj
