---
mentegraf-node: ch11
---

# İş listesi ve bölüm özeti

## İş listesi

![İş listesi](../assets/is-listesi.png){#fig:is-listesi}

Sol araç çubuğundaki **İş listesi** düğmesi kitapta yapılacak her şeyi tek yerde toplar (@fig:is-listesi):

- açık sorular,
- bitmemiş görevler,
- henüz karara bağlanmamış (Taslak) ya da Tartışmalı iddialar,
- pasajı metinden kaybolmuş iddia ve sorular (en üstte, "pasaj yok" işaretiyle).

Desteklendi ve Tez durumundaki iddialar ile Yanıtlandı ve Kitabın ötesinde durumundaki sorular listede yer almaz: bunlar yapılacak iş değildir.

Öğeler, kitap planındaki sırayla bölüm bölüm gruplanır. Üstteki düğmeler listeyi yalnızca sorulara, görevlere ya da iddialara daraltır; **Bitenler** tamamlanmışları da gösterir. Bir öğeye tıklamak paragrafını açar; bir görevin kutusunu işaretlemek onu tamamlar. Bir kategori filtresi açıksa liste yalnızca o kategoriye ait öğeleri gösterir.

İş listesi, haritanın metinden kopup kopmadığını da gösterir: bir paragrafı silip yeniden yazdığınızda o paragrafa bağlı iddia "pasaj yok" olarak burada belirir. Haritayı bakımlı tutmak için ayrıca bir şey yapmanız gerekmez; koptuğu yeri liste söyler. ^kopma

### Şüpheli sözcükler

Bazı yanlışları yazım denetimi yakalayamaz, çünkü her iki yazılış da gerçek bir sözcüktür: "kar" ile "kâr", "hala" ile "hâlâ". Bu sözcükler iş listesinin **Kitap geneli** grubunda **şüpheli** işaretiyle listelenir: hangi yazılışın kaç kez geçtiği ve kısa bir açıklama, örneğin "kar 3 kez · kâr 5 kez — kâr: kazanç; kar: yağış". Tıkladıkça sözcüğün geçtiği yerler sırayla açılır; hepsi doğruysa ✓ ile listeden çıkarın. Yazılışlardan yalnızca biri geçiyorsa da listelenir: belki öteki kastedilmiştir.

Liste projenin klasöründedir: `.mentegraf/suspicious.txt`. İlk denetimde şu çiftlerle oluşturulur: kar/kâr, hala/hâlâ, adet/âdet, hakim/hâkim, ama/âmâ, alem/âlem, kağıt/kâğıt. Düz metindir ve elle düzenlenir; satır başına bir grup:

```
kar | kâr* — kâr: kazanç; kar: yağış
```

`|` karışabilen yazılışları ayırır, `—` işaretinden sonrası açıklamadır. Sonuna `*` konan yazılış ekli hâlleri de bulur ("kâr*": kârı, kârlı). Büyük/küçük harf fark etmez, şapka eder. `#` ile başlayan satırlar açıklamadır. Liste kitapla birlikte taşınır ve eşitlenir.

## Bölüm özeti

![Bölüm özeti](../assets/ozet.png){#fig:ozet}

Metni olan her düğümün panelinde, ve iş listesinde her bölüm başlığının yanında, **Özet** düğmesi vardır. Özet (@fig:ozet) o bölüm hakkında haritanın bildiği her şeyi tek sayfada toplar:

- durum, kategoriler ve bölümün açıklaması,
- iddialar, durumlarına göre; her birinin altında onu destekleyen (✓), onunla çelişen (✕) ve dayandığı (❝) öğeler,
- sorular ve yanıtları,
- görevler,
- bölümün bağlı olduğu kişiler, kavramlar ve diğer düğümler, türlerine göre.

**Markdown olarak kopyala** özeti panoya alır; bir editöre, bir e-postaya ya da bir notlar dosyasına yapıştırılabilir. Yazmaya oturmadan önce bir bölümün özetine bakmak, o bölümde neyi savunduğunuzu ve neyin eksik olduğunu hatırlamanın en hızlı yoludur.
