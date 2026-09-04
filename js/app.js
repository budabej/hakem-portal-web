// -----------------------------------------------------------------------
// Hakem Portalı - istemci tarafı mantık.
// Bu dosya SADECE anon (public) Supabase anahtarını kullanır. Tüm veri
// koruması Supabase tarafında Row Level Security (RLS) ile sağlanır:
// bu kod bozuk/kötü niyetli olsa dahi bir hakem başka bir hakemin
// satırını okuyamaz (bkz. sql/schema.sql).
// -----------------------------------------------------------------------

const cfg = window.HAKEM_PORTAL_CONFIG;
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const el = (id) => document.getElementById(id);
const goster = (id, evet) => { el(id).hidden = !evet; };

let mevcutProfil = null;

async function baslat() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await girisSonrasi();
  } else {
    ekranGoster("giris");
  }
}

function ekranGoster(ad) {
  goster("girisEkrani", ad === "giris");
  goster("sifreEkrani", ad === "sifre");
  goster("panel", ad === "panel");
  goster("cikisBtn", ad === "panel" || ad === "sifre");
}

async function girisSonrasi() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { ekranGoster("giris"); return; }

  const { data: profil, error } = await sb
    .from("hakemler")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profil) {
    el("girisHata").textContent = "Profiliniz bulunamadı. Lütfen MHK ile iletişime geçin.";
    el("girisHata").hidden = false;
    await sb.auth.signOut();
    ekranGoster("giris");
    return;
  }

  mevcutProfil = profil;

  if (profil.sifre_degistirmesi_gerekiyor) {
    ekranGoster("sifre");
    return;
  }

  panelDoldur(profil);
  ekranGoster("panel");
  karneYukle(user.id);
  vizeAidatYukle(user.id);
}

function panelDoldur(profil) {
  el("hosgeldin").textContent = `Merhaba, ${profil.ad_soyad}`;
  el("pSicil").textContent = profil.sicil_no;
  el("pKademe").textContent = profil.kademe;
  el("pIl").textContent = profil.il || "—";
  el("pEgitim").textContent = profil.egitim || "—";
  el("pDil").textContent = profil.yabanci_dil || "—";
  el("iletisimEmail").value = profil.iletisim_email || "";
  el("telefon").value = profil.telefon || "";
}

async function vizeAidatYukle(hakemId) {
  const [{ data: vize }, { data: aidat }] = await Promise.all([
    sb.from("hakem_vize_kayitlari").select("yil").eq("hakem_id", hakemId).order("yil", { ascending: false }),
    sb.from("hakem_aidat_kayitlari").select("yil").eq("hakem_id", hakemId).order("yil", { ascending: false }),
  ]);
  yilListesiCiz("vizeListesi", vize || []);
  yilListesiCiz("aidatListesi", aidat || []);
}

function yilListesiCiz(containerId, kayitlar) {
  const kapsayici = el(containerId);
  if (kayitlar.length === 0) {
    kapsayici.innerHTML = `<span class="muted">Kayıt yok.</span>`;
    return;
  }
  kapsayici.innerHTML = kayitlar.map((k) => `<span class="yil-chip">${k.yil}</span>`).join("");
}

async function karneYukle(hakemId) {
  goster("karneYukleniyor", true);
  goster("karneBos", false);
  goster("karneTablo", false);

  const { data, error } = await sb
    .from("hakem_puanlari")
    .select("*")
    .eq("hakem_id", hakemId)
    .order("yarisma_tarihi", { ascending: false });

  goster("karneYukleniyor", false);

  if (error || !data || data.length === 0) {
    goster("karneBos", true);
    istatistikleriDoldur([]);
    return;
  }

  const tbody = el("karneTbody");
  tbody.innerHTML = "";
  for (const satir of data) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${kacir(satir.yarisma_adi)}</td>
      <td>${kacir(satir.yarisma_tarihi)}</td>
      <td>${kacir(satir.yarisma_yeri)}</td>
      <td>${kacir(satir.kategori_adi)}</td>
      <td>${kacir(satir.round)}</td>
      <td>${satir.puan ?? "—"}</td>
    `;
    tbody.appendChild(tr);
  }
  goster("karneTablo", true);
  istatistikleriDoldur(data);
}

function istatistikleriDoldur(data) {
  if (!data || data.length === 0) {
    goster("istatistikBos", true);
    goster("istatistikAlan", false);
    return;
  }
  goster("istatistikBos", false);
  goster("istatistikAlan", true);

  const buYilNo = new Date().getFullYear();
  const sonEsikYil = buYilNo - 1; // son 2 yil (bu yil dahil)

  const tumZaman = kategoriOzet(data);
  const sonYillar = kategoriOzet(data.filter((s) => {
    if (!s.yarisma_tarihi) return false;
    const yil = parseInt(String(s.yarisma_tarihi).slice(0, 4), 10);
    return yil >= sonEsikYil;
  }));

  listeDoldur("istTumBasarili", tumZaman.enIyi);
  listeDoldur("istTumBasarisiz", tumZaman.enKotu);
  listeDoldur("istSonBasarili", sonYillar.enIyi);
  listeDoldur("istSonBasarisiz", sonYillar.enKotu);
}

function kategoriOzet(satirlar) {
  const grup = new Map();
  for (const s of satirlar) {
    if (s.puan === null || s.puan === undefined || !s.kategori_adi) continue;
    const g = grup.get(s.kategori_adi) || { toplam: 0, adet: 0 };
    g.toplam += Number(s.puan);
    g.adet += 1;
    grup.set(s.kategori_adi, g);
  }
  const liste = [...grup.entries()].map(([kategori, g]) => ({
    kategori, ortalama: g.toplam / g.adet, adet: g.adet,
  }));
  return {
    enIyi: [...liste].sort((a, b) => b.ortalama - a.ortalama).slice(0, 3),
    enKotu: [...liste].sort((a, b) => a.ortalama - b.ortalama).slice(0, 3),
  };
}

function listeDoldur(id, kayitlar) {
  const ul = el(id);
  if (!kayitlar || kayitlar.length === 0) {
    ul.innerHTML = `<li class="muted">Yeterli veri yok.</li>`;
    return;
  }
  ul.innerHTML = kayitlar.map((k) =>
    `<li>${kacir(k.kategori)} — <strong>${k.ortalama.toFixed(1)}</strong> (${k.adet} kayıt)</li>`
  ).join("");
}

function kacir(deger) {
  if (deger === null || deger === undefined) return "—";
  const d = document.createElement("div");
  d.textContent = deger;
  return d.innerHTML;
}

// ---- Olay dinleyicileri ----

el("girisForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  el("girisHata").hidden = true;
  const email = el("girisEmail").value.trim();
  const sifre = el("girisSifre").value;

  const { error } = await sb.auth.signInWithPassword({ email, password: sifre });
  if (error) {
    el("girisHata").textContent = "Giriş başarısız: e-posta ya da şifre hatalı.";
    el("girisHata").hidden = false;
    return;
  }
  await girisSonrasi();
});

el("sifreForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  el("sifreHata").hidden = true;
  const s1 = el("yeniSifre1").value;
  const s2 = el("yeniSifre2").value;

  if (s1 !== s2) {
    el("sifreHata").textContent = "Girdiğiniz şifreler birbiriyle uyuşmuyor.";
    el("sifreHata").hidden = false;
    return;
  }

  const { error: sifreHata } = await sb.auth.updateUser({ password: s1 });
  if (sifreHata) {
    el("sifreHata").textContent = "Şifre kaydedilemedi: " + sifreHata.message;
    el("sifreHata").hidden = false;
    return;
  }

  const { data: { user } } = await sb.auth.getUser();
  await sb.from("hakemler").update({ sifre_degistirmesi_gerekiyor: false }).eq("id", user.id);

  await girisSonrasi();
});

el("iletisimForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const durum = el("iletisimDurum");
  durum.textContent = "Kaydediliyor…";

  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from("hakemler").update({
    iletisim_email: el("iletisimEmail").value.trim() || null,
    telefon: el("telefon").value.trim() || null,
  }).eq("id", user.id);

  durum.textContent = error ? "Kaydedilemedi." : "Kaydedildi.";
  setTimeout(() => { durum.textContent = ""; }, 2500);
});

el("cikisBtn").addEventListener("click", async () => {
  await sb.auth.signOut();
  mevcutProfil = null;
  el("girisForm").reset();
  ekranGoster("giris");
});

baslat();
