"use strict";

const $ = s => document.querySelector(s);
const content = $("#content");
const status = $("#status");
const search = $("#search");
const searchWrap = $("#search-wrap");
const modal = $("#modal");
const box = $("#modal-content");
const title = $("#view-title");
const subtitle = $("#subtitle");
const mobile = $("#mobile-menu");

let view = "home";
let all = [];
let roles = [];
let timer;
let refreshTimer;
let reviewsTimer;
let selected = null;
let activeConversationId = null;

const fallback = "/logo.svg.JPG";

const esc = v =>
  String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

const num = v =>
  new Intl.NumberFormat("ar-SA").format(Number(v) || 0);

const avatar = m => m?.avatar || fallback;

function setStatus(x) {
  if (status) status.textContent = x;
}

function openModal() {
  if (!modal) return;
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeModal() {
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function bind() {
  document.querySelectorAll("[data-member]").forEach(x => {
    x.onclick = () => openMember(x.dataset.member);
  });

  document.querySelectorAll("[data-role]").forEach(x => {
    x.onclick = () => openRole(x.dataset.role);
  });
}

function card(m) {
  return `
    <article class="card" data-member="${esc(m.id)}">
      <img src="${esc(avatar(m))}" onerror="this.src='${fallback}'">
      <div>
        <h3>${esc(m.name)}</h3>
        <p>@${esc(m.username || "")}</p>
        <div class="roles">
          ${
            (m.importantRoles || []).map(r =>
              `<span class="role">${esc(r.name)}</span>`
            ).join("")
            || `<span class="member-tag">عضو</span>`
          }
        </div>
      </div>
      <b>↗</b>
    </article>
  `;
}

function renderMembers(list) {
  content.className = "grid";

  content.innerHTML = list.length
    ? list.map(card).join("")
    : `
      <div class="empty">
        <h3>لا توجد نتائج</h3>
        <p>تأكد من تفعيل Server Members Intent.</p>
      </div>
    `;

  bind();
}

async function renderReviews() {
  if (view !== "home") return;

  if (searchWrap) searchWrap.style.display = "none";

  title.textContent = "آراء مجتمع MALADH";
  subtitle.textContent = "تجارب وآراء أعضاء المجتمع بشكل مرتب.";

  let list = [];

  try {
    const d = await fetch("/api/platform/reviews", {
      cache: "no-store"
    }).then(r => r.json());

    list = d.reviews || [];
  } catch (e) {}

  content.className = "reviews-section";

  content.innerHTML = `
    <section class="reviews-showcase">
      <div class="reviews-head">
        <div>
          <span class="eyebrow">COMMUNITY REVIEWS</span>
          <h2>وش يقولون أعضاء MLD؟</h2>
          <p>آراء المجتمع تظهر هنا بشكل أنيق.</p>
        </div>

        <button id="add-review-btn" class="primary">
          ＋ إضافة رأي
        </button>
      </div>

      <div class="reviews-carousel">
        ${
          list.slice(0, 6).map(r => `
            <article class="review-card">
              <div class="review-top">
                <div class="review-avatar">
                  ${esc((r.user?.displayName || "عضو").slice(0, 1))}
                </div>

                <div>
                  <h3>${esc(r.user?.displayName || "عضو")}</h3>
                  <p>@${esc(r.user?.username || "member")}</p>
                </div>

                <span class="review-stars">
                  ${"★".repeat(
                    Math.max(1, Math.min(5, Number(r.rating) || 5))
                  )}
                </span>
              </div>

              <p class="review-text">
                “${esc(r.text)}”
              </p>

              <small>عضو من مجتمع MLD</small>
            </article>
          `).join("")
          ||
          `
            <div class="empty">
              <h3>ما فيه آراء حتى الآن</h3>
            </div>
          `
        }
      </div>

      <div id="review-form-wrap"></div>
    </section>
  `;

  const addReview = $("#add-review-btn");

  if (addReview) {
    addReview.onclick = async () => {
      const me = await fetch("/api/auth/me", {
        cache: "no-store"
      }).then(r => r.json()).catch(() => ({}));

      if (!me.authenticated) {
        setStatus("سجّل دخولك أولًا لإضافة رأي");
        return;
      }

      const wrap = $("#review-form-wrap");

      wrap.innerHTML = `
        <form id="review-form" class="review-submit">
          <h3>إضافة رأي</h3>

          <textarea
            id="review-text"
            class="full"
            maxlength="600"
            placeholder="اكتب رأيك عن MALADH..."
            required
          ></textarea>

          <select id="review-rating" class="full">
            <option value="5">★★★★★ ممتاز</option>
            <option value="4">★★★★ جيد جدًا</option>
            <option value="3">★★★ جيد</option>
            <option value="2">★★ يحتاج تحسين</option>
            <option value="1">★</option>
          </select>

          <div>
            <button class="primary">نشر الرأي</button>
            <button
              type="button"
              id="cancel-review"
              class="secondary"
            >
              إلغاء
            </button>
          </div>

          <span id="review-status" class="muted"></span>
        </form>
      `;

      $("#cancel-review").onclick = () => {
        wrap.innerHTML = "";
      };

      $("#review-form").onsubmit = async e => {
        e.preventDefault();

        try {
          const r = await fetch("/api/platform/reviews", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              text: $("#review-text").value,
              rating: $("#review-rating").value
            })
          });

          const d = await r.json();

          if (!r.ok) {
            throw Error(d.error);
          }

          await renderReviews();
        } catch (err) {
          $("#review-status").textContent =
            err.message || "تعذر نشر الرأي";
        }
      };

      $("#review-text").focus();
    };
  }

  setStatus(
    list.length
      ? num(list.length) + " رأي منشور"
      : "بانتظار أول رأي من الأعضاء"
  );
}

function topSec(t, list, k, l) {
  return `
    <section class="top-section">
      <h3>${t}</h3>

      ${
        list.map((m, i) => `
          <article
            class="top-card"
            data-member="${esc(m.id)}"
          >
            <span class="rank">${i + 1}</span>

            <img src="${esc(avatar(m))}">

            <div>
              <small>${l}</small>
              <h4>${esc(m.name)}</h4>
              <strong>${num(m.stats?.[k])}</strong>
            </div>
          </article>
        `).join("")
        ||
        `<p class="muted">لا توجد بيانات بعد.</p>`
      }
    </section>
  `;
}

function renderTop(d) {
  content.className = "top-grid";

  content.innerHTML =
    topSec(
      "🏆 أكثر الرسائل",
      d.messages || [],
      "messages",
      "رسالة"
    ) +
    topSec(
      "💬 أكثر المنشنات",
      d.mentions || [],
      "mentionsReceived",
      "منشن"
    ) +
    topSec(
      "🎙️ وقت الصوت",
      d.voice || [],
      "voiceMinutes",
      "دقيقة"
    ) +
    topSec(
      "⚡ دخول صوتي",
      d.joins || [],
      "voiceJoins",
      "دخول"
    );

  bind();
}

function renderRoles() {
  content.className = "role-grid";

  content.innerHTML = roles.map(r => `
    <article
      class="role-card"
      data-role="${esc(r.id)}"
    >
      <div class="role-top">
        <i style="background:${esc(r.color)}"></i>
        <b>${num(r.membersCount)} عضو</b>
      </div>

      <h3>${esc(r.name)}</h3>

      <div class="roles">
        ${
          (r.permissions || [])
            .slice(0, 4)
            .map(p => `<span class="permission">${esc(p)}</span>`)
            .join("")
          ||
          `<span class="muted">صلاحيات عادية</span>`
        }
      </div>

      <small>عرض الأعضاء ↗</small>
    </article>
  `).join("");

  bind();
}

function messageView() {
  title.textContent = "رسالة خاصة";
  subtitle.textContent =
    "اختر عضوًا واكتب رسالتك؛ ستصل داخل Embed بعنوان.";

  if (searchWrap) searchWrap.style.display = "none";

  content.className = "message-page";

  content.innerHTML = `
    <div class="message-box">
      <div class="message-icon">✦</div>

      <h3>إرسال رسالة خاصة</h3>

      <p class="muted">
        اكتب اسم العضو للبحث ثم اختره من النتائج.
      </p>

      <input
        id="recipient-search"
        class="full"
        placeholder="ابحث عن المستلم..."
      >

      <div id="recipient-results" class="recipient-results"></div>

      <input
        id="msg-title"
        class="full"
        maxlength="120"
        placeholder="عنوان الرسالة"
      >

      <label class="check">
        <input id="show-name" type="checkbox">
        إظهار اسم المرسل
      </label>

      <input
        id="sender-name"
        class="full hidden"
        maxlength="60"
        placeholder="اسم المرسل"
      >

      <textarea
        id="msg-text"
        class="full"
        maxlength="2000"
        placeholder="اكتب رسالتك..."
      ></textarea>

      <p id="msg-status"></p>

      <button id="send" class="primary wide">
        إرسال الآن
      </button>
    </div>
  `;

  const rs = $("#recipient-search");

  rs.oninput = async () => {
    const q = rs.value.trim();

    if (!q) {
      $("#recipient-results").innerHTML = "";
      return;
    }

    const d = await fetch(
      `/api/public/members?q=${encodeURIComponent(q)}`,
      { cache: "no-store" }
    ).then(r => r.json());

    $("#recipient-results").innerHTML =
      (d.members || [])
        .slice(0, 8)
        .map(m => `
          <button
            class="recipient"
            data-recipient="${esc(m.id)}"
          >
            <img src="${esc(avatar(m))}">

            <span>
              ${esc(m.name)}
              <small>@${esc(m.username || "")}</small>
            </span>
          </button>
        `).join("");

    document
      .querySelectorAll("[data-recipient]")
      .forEach(x => {
        x.onclick = () => {
          selected = {
            id: x.dataset.recipient,
            name: x.textContent
          };

          rs.value = x.textContent;

          $("#recipient-results").innerHTML =
            "<b class='selected'>تم اختيار المستلم ✓</b>";
        };
      });
  };

  $("#show-name").onchange = e => {
    $("#sender-name").classList.toggle(
      "hidden",
      !e.target.checked
    );
  };

  $("#send").onclick = sendMessage;
}

async function sendMessage() {
  const st = $("#msg-status");
  const btn = $("#send");

  const text = $("#msg-text").value.trim();
  const show = $("#show-name").checked;
  const name = $("#sender-name").value.trim();

  if (!selected) {
    st.textContent = "اختر مستلمًا أولًا";
    return;
  }

  if (!text) {
    st.textContent = "اكتب الرسالة أولًا";
    return;
  }

  if (show && !name) {
    st.textContent = "اكتب اسم المرسل";
    return;
  }

  btn.disabled = true;

  try {
    const r = await fetch("/api/public/message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        memberId: selected.id,
        title:
          $("#msg-title").value.trim() ||
          "رسالة من إدارة MLD",
        message: show
          ? `من: ${name}\n\n${text}`
          : text
      })
    });

    const d = await r.json();

    if (!r.ok) {
      throw Error(d.error);
    }

    st.textContent = "تم الإرسال بنجاح ✓";
    $("#msg-text").value = "";
  } catch (e) {
    st.textContent = e.message || "تعذر الإرسال";
  } finally {
    btn.disabled = false;
  }
}

function perms(a) {
  return a?.length
    ? a.map(x =>
        `<span class="permission">${esc(x)}</span>`
      ).join("")
    : `<span class="muted">لا توجد</span>`;
}

async function openMember(id) {
  openModal();

  box.innerHTML =
    "<div class='loading'>جاري التحميل...</div>";

  const m = await fetch(`/api/public/member/${id}`)
    .then(r => r.json());

  const s = m.stats || {};

  box.innerHTML = `
    <div class="profile">
      <div class="profile-head">
        <img src="${esc(avatar(m))}">

        <div>
          <p class="eyebrow">ملف العضو</p>
          <h2>${esc(m.name)}</h2>
          <p class="muted">@${esc(m.username || "")}</p>
          <span class="badge">${esc(m.rank || "عضو")}</span>
        </div>
      </div>

      <div class="stats">
        ${
          [
            [s.messages, "رسالة"],
            [s.mentionsReceived, "منشن جاه"],
            [s.mentionsSent, "منشن أرسله"],
            [
              `${Math.floor((s.voiceMinutes || 0) / 60)}س ${(s.voiceMinutes || 0) % 60}د`,
              "وقت صوتي"
            ],
            [s.voiceJoins, "دخول صوتي"],
            [s.chatRounds, "نشاط شات"]
          ]
            .map(x =>
              `<b>${esc(num(x[0]))}<small>${x[1]}</small></b>`
            ).join("")
        }
      </div>

      <h3>كل الرتب</h3>

      <div class="roles">
        ${
          (m.roles || [])
            .map(x =>
              `<span class="role">${esc(x.name)}</span>`
            ).join("")
          ||
          `<span class="muted">لا توجد رتب</span>`
        }
      </div>

      <h3>أقوى الصلاحيات</h3>

      <div class="permission-box">
        ${perms(m.permissions)}
      </div>
    </div>
  `;
}

async function openRole(id) {
  openModal();

  box.innerHTML =
    "<div class='loading'>جاري تحميل الرتبة...</div>";

  const d = await fetch(
    `/api/public/roles/${id}/members`
  ).then(r => r.json());

  box.innerHTML = `
    <p class="eyebrow">دليل الرتبة</p>
    <h2>${esc(d.role.name)}</h2>

    <div class="role-meta">
      <b>${num(d.role.membersCount)} عضو فعلي</b>
    </div>

    <div class="permission-box">
      ${perms(d.role.permissions)}
    </div>

    <h3>الأعضاء</h3>

    <div class="grid compact">
      ${
        (d.members || []).map(card).join("")
        ||
        `<p class="muted">لا يوجد أعضاء بهذه الرتبة.</p>`
      }
    </div>
  `;

  bind();
}

async function refresh() {
  try {
    const [sr, rr] = await Promise.allSettled([
      fetch("/api/public/server", {
        cache: "no-store"
      }),

      fetch("/api/public/roles", {
        cache: "no-store"
      })
    ]);

    let serverOk = false;
    let rolesOk = false;

    if (sr.status === "fulfilled") {
      const s = await sr.value.json().catch(() => null);

      if (sr.value.ok && s) {
        serverOk = true;

        $("#server-name").textContent =
          s.name || "MLD";

        $("#server-count").textContent =
          num(s.memberCount);

        $("#online-count").textContent =
          num(s.onlineCount);

        $("#visit-count").textContent =
          num(s.visits);

        if (s.invite) {
          $("#invite").href = s.invite;
          $("#invite-mobile").href = s.invite;

          const fd = $("#floating-discord");

          if (fd) fd.href = s.invite;
        }
      }
    }

    if (rr.status === "fulfilled") {
      const rd = await rr.value.json().catch(() => null);

      if (rr.value.ok && rd) {
        rolesOk = true;
        roles = rd.roles || [];
      }
    }

    if (
      view === "members" &&
      (!search || !search.value)
    ) {
      try {
        const mr = await fetch(
          "/api/public/members",
          { cache: "no-store" }
        );

        const d = await mr.json().catch(() => ({}));

        if (mr.ok) {
          all = d.members || [];
          renderMembers(all);
          setStatus(num(all.length) + " عضو");
        }
      } catch {}
    } else if (
      view === "roles" &&
      rolesOk
    ) {
      renderRoles();
    } else if (view === "top") {
      try {
        const tr = await fetch(
          "/api/public/top",
          { cache: "no-store" }
        );

        const td = await tr.json().catch(() => ({}));

        if (tr.ok) renderTop(td);
      } catch {}
    }

    if (
      !serverOk &&
      !rolesOk &&
      view === "home"
    ) {
      setStatus(
        "تعذر تحديث بيانات ديسكورد — جاري إعادة المحاولة"
      );
    }
  } catch (e) {
    setStatus(
      "تعذر تحديث البيانات — جاري إعادة المحاولة"
    );
  }
}

async function searchMembers() {
  clearTimeout(timer);

  const q = search?.value.trim() || "";
  const suggestionBox = $("#search-suggestions");

  if (!q) {
    if (suggestionBox) {
      suggestionBox.classList.add("hidden");
    }

    renderMembers(all);
    setStatus(num(all.length) + " عضو");
    return;
  }

  setStatus("جاري البحث...");

  timer = setTimeout(async () => {
    const d = await fetch(
      "/api/public/members?q=" +
        encodeURIComponent(q),
      { cache: "no-store" }
    ).then(r => r.json());

    const list = d.members || [];

    if (suggestionBox) {
      suggestionBox.innerHTML =
        list.slice(0, 8).map(m => `
          <button
            class="search-suggestion"
            data-suggest-member="${esc(m.id)}"
          >
            <img src="${esc(avatar(m))}">

            <span>
              <b>${esc(m.name)}</b>
              <small>@${esc(m.username || "")}</small>
            </span>
          </button>
        `).join("");

      suggestionBox.classList.toggle(
        "hidden",
        !list.length
      );

      suggestionBox
        .querySelectorAll("[data-suggest-member]")
        .forEach(x => {
          x.onclick = () => {
            suggestionBox.classList.add("hidden");
            openMember(x.dataset.suggestMember);
          };
        });
    }

    renderMembers(list);
    setStatus(num(list.length) + " نتيجة");
  }, 180);
}

function syncAdminMenu(me) {
  const role =
    me?.authenticated
      ? me.user?.role
      : null;

  document
    .querySelectorAll('[data-view="admin"]')
    .forEach(b => {
      b.style.display =
        role === "admin" || role === "owner"
          ? "flex"
          : "none";
    });

  document
    .querySelectorAll('[data-view="owner"]')
    .forEach(b => {
      b.style.display =
        role === "owner"
          ? "flex"
          : "none";
    });
}

function renderAccount() {
  if (searchWrap) {
    searchWrap.style.display = "none";
  }

  title.textContent = "الحساب";

  subtitle.textContent =
    "تسجيل الدخول أو إنشاء حساب MALADH المرتبط بعضوية ديسكورد.";

  content.className = "account-grid";

  content.innerHTML = `
    <div class="account-card">
      <p class="eyebrow">MLD ACCOUNT</p>

      <h3>تسجيل الدخول</h3>

      <input
        id="login-user"
        class="full"
        placeholder="اسم المستخدم"
      >

      <input
        id="login-pass"
        class="full"
        type="password"
        placeholder="كلمة المرور"
      >

      <button
        id="login-btn"
        class="primary wide"
      >
        تسجيل الدخول
      </button>

      <p id="login-status" class="muted"></p>
    </div>

    <div class="account-card">
      <p class="eyebrow">NEW ACCOUNT</p>

      <h3>إنشاء حساب</h3>

      <input
        id="signup-user"
        class="full"
        placeholder="اسم المستخدم"
      >

      <input
        id="signup-pass"
        class="full"
        type="password"
        placeholder="كلمة المرور"
      >

      <input
        id="signup-discord"
        class="full"
        placeholder="يوزر ديسكورد"
      >

      <button
        id="signup-btn"
        class="primary wide"
      >
        إرسال زر التأكيد للديسكورد
      </button>

      <div id="verify-box"></div>

      <p id="signup-status" class="muted"></p>
    </div>
  `;

  $("#login-btn").onclick = loginAccount;
  $("#signup-btn").onclick = startSignup;
}

async function loginAccount() {
  const st = $("#login-status");

  st.textContent = "جاري الدخول...";

  try {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: $("#login-user").value,
        password: $("#login-pass").value
      })
    });

    const d = await r.json();

    st.textContent =
      d.error || "تم تسجيل الدخول ✓";

    if (r.ok) {
      syncAdminMenu({
        authenticated: true,
        user: d.user
      });

      renderAccountLogged(d.user);
    }
  } catch (e) {
    st.textContent =
      e.message || "تعذر تسجيل الدخول";
  }
}

async function startSignup() {
  const st = $("#signup-status");

  st.textContent =
    "جاري إرسال زر التأكيد...";

  try {
    const r = await fetch("/api/auth/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: $("#signup-user").value,
        password: $("#signup-pass").value,
        discordUsername: $("#signup-discord").value
      })
    });

    const d = await r.json();

    st.textContent =
      d.error || d.message;

    if (
      r.ok &&
      d.verificationRequired
    ) {
      $("#verify-box").innerHTML = `
        <p class="verify-wait">
          افتح الخاص في ديسكورد واضغط
          «تأكيد إنشاء حساب MALADH»،
          ثم اضغط الزر أدناه.
        </p>

        <button
          id="verify-btn"
          class="primary wide"
        >
          إكمال إنشاء الحساب
        </button>
      `;

      $("#verify-btn").onclick =
        finishSignup;
    }
  } catch (e) {
    st.textContent =
      e.message || "تعذر بدء التسجيل";
  }
}

async function finishSignup() {
  const st = $("#signup-status");
  const username = $("#signup-user").value;

  try {
    const r = await fetch(
      "/api/auth/verify-signup",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username
        })
      }
    );

    const d = await r.json();

    st.textContent =
      d.error || "تم إنشاء الحساب ✓";

    if (r.ok) {
      syncAdminMenu({
        authenticated: true,
        user: d.user
      });

      renderAccountLogged(d.user);
    }
  } catch (e) {
    st.textContent =
      e.message || "تعذر إكمال التسجيل";
  }
}

function renderAccountLogged(u) {
  if (searchWrap) {
    searchWrap.style.display = "none";
  }

  title.textContent = "حسابي";
  subtitle.textContent =
    "تم تسجيل الدخول بنجاح.";

  content.className = "account-grid";

  content.innerHTML = `
    <div class="account-card account-ok">
      <p class="eyebrow">SIGNED IN</p>

      <h3>${esc(u.displayName || u.username)}</h3>

      <p class="muted">
        @${esc(u.username)} · ${esc(u.role)}
      </p>

      <button
        id="logout-btn"
        class="primary"
      >
        تسجيل الخروج
      </button>
    </div>
  `;

  $("#logout-btn").onclick = async () => {
    await fetch(
      "/api/auth/logout",
      { method: "POST" }
    );

    syncAdminMenu({
      authenticated: false
    });

    renderAccount();
  };
}

async function apiRequest(url, options) {
  const r = await fetch(
    url,
    Object.assign(
      {
        headers: {
          "Content-Type": "application/json"
        }
      },
      options || {}
    )
  );

  const d = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw Error(
      d.error || "تعذر تنفيذ الطلب"
    );
  }

  return d;
}

const GAME_CATALOG = {
  "أونو": {
    min: 2,
    max: 8,
    desc: "أونو — أوراق، ألوان، أرقام وأدوار متزامنة."
  },

  "بلوت": {
    min: 4,
    max: 4,
    desc: "بلوت — طاولة أربع لاعبين مع مقاعد ثابتة."
  },

  "جاكارو": {
    min: 2,
    max: 4,
    desc: "جاكارو — طاولة ومسارات وحركة أحجار."
  },

  "لودو": {
    min: 2,
    max: 4,
    desc: "لودو — لوحة أربع ألوان وحركة أحجار."
  },

  "مافيا": {
    min: 4,
    max: 16,
    desc: "مافيا — أدوار سرية، ليل ونهار وتصويت."
  },

  "مونوبولي": {
    min: 2,
    max: 6,
    desc: "مونوبولي — شراء وتداول وإدارة أموال."
  },

  "كود نيمز": {
    min: 2,
    max: 10,
    desc: "كود نيمز — فريقان، قائد تلميحات وتخمين كلمات."
  },

  "رووليت": {
    min: 2,
    max: 12,
    desc: "رووليت — جولات سريعة بنظام نقاط."
  }
};

function deviceClass() {
  const w = innerWidth;
  const ua = navigator.userAgent;

  if (/iPad|Tablet/i.test(ua)) {
    return "ipad";
  }

  if (/Mobi|Android|iPhone/i.test(ua)) {
    return "mobile";
  }

  return w < 900
    ? "tablet"
    : "desktop";
}

function gameShell(room, game, device) {
  const cfg =
    GAME_CATALOG[game] ||
    {
      min: 2,
      max: 12,
      desc: "لعبة MLD"
    };

  return `
    <div
      class="game-stage ${device}"
      data-game="${esc(game)}"
    >
      <div class="game-toolbar">
        <div>
          <b>${esc(game)}</b>
          <small>${esc(cfg.desc)}</small>
        </div>

        <span class="device-badge">
          ${esc(device)}
        </span>

        <button
          id="game-ready"
          class="primary"
        >
          جاهز
        </button>

        <button
          id="game-start"
          class="primary"
        >
          ابدأ
        </button>

        <button
          id="game-expand"
          class="primary"
        >
          تكبير
        </button>

        <button
          id="game-leave"
          class="primary"
        >
          مغادرة
        </button>

        <button
          id="game-end"
          class="primary"
        >
          إنهاء الجلسة
        </button>
      </div>

      <div
        id="mld-game-board"
        class="mld-game-board"
      >
        <button
          id="game-exit-expanded"
          class="primary"
        >
          إغلاق التكبير
        </button>

        <div class="mld-table">
          <div class="mld-watermark">
            MALAZH
            <br>
            <small>MLD • COMMUNITY</small>
          </div>

          <div id="game-ui" class="game-ui"></div>
        </div>
      </div>

      <div class="game-info">
        <span>
          الجلسة: ${esc(room.title)}
        </span>

        <span>
          اللاعبون:
          ${room.participants.length}/${room.maxPlayers}
        </span>

        <span>
          المشاهدون:
          ${room.spectators.length}
        </span>
      </div>
    </div>
  `;
}

async function sendGameMove(roomId, move) {
  try {
    await apiRequest(
      "/api/platform/rooms/" +
        roomId +
        "/action",
      {
        method: "POST",
        body: JSON.stringify({
          action: "game",
          move
        })
      }
    );

    await openGameRoom(
      roomId,
      document.querySelector(
        ".game-stage"
      )?.dataset?.game ||
        window.__activeGame
    );
  } catch (e) {
    setStatus(e.message);
  }
}

function renderGameBoard(game, room) {
  const ui = $("#game-ui");

  if (!ui) return;

  const gs = room.gameState || {};
  let h = "";

  if (!room.started) {
    h = `
      <div class="generic-game">
        <h2>الطاولة جاهزة</h2>
        <p class="muted">
          اضغط جاهز ثم يبدأ مالك الجلسة.
        </p>
      </div>
    `;
  } else if (game === "أونو") {
    const hand =
      gs.hands?.[window.__meUsername] || [];

    h = `
      <div class="uno-hand">
        ${
          hand.map((c, i) => `
            <button
              class="game-card"
              onclick="sendGameMove('${room.id}',{type:'play',index:${i}})"
            >
              ${esc(c.c || "wild")}
              ${esc(String(c.n))}
            </button>
          `).join("")
        }
      </div>

      <button
        class="primary"
        onclick="sendGameMove('${room.id}',{type:'draw'})"
      >
        سحب ورقة
      </button>
    `;
  } else if (game === "بلوت") {
    const hand =
      gs.hands?.[window.__meUsername] || [];

    h = `
      <div class="card-table">
        <div class="seat top">لاعب 2</div>
        <div class="seat left">لاعب 3</div>
        <div class="seat right">لاعب 4</div>
        <div class="seat bottom">أنت</div>

        <div class="deck">
          MLD
          <br>
          <small>بلوت</small>
        </div>
      </div>

      <div class="uno-hand">
        ${
          hand.map((c, i) => `
            <button
              class="game-card"
              onclick="sendGameMove('${room.id}',{type:'play',index:${i}})"
            >
              ${esc(c.suit || "")}${esc(c.rank || "")}
            </button>
          `).join("")
        }
      </div>

      <button
        class="primary"
        onclick="sendGameMove('${room.id}',{type:'deal'})"
      >
        توزيع
      </button>
    `;
  } else if (game === "كود نيمز") {
    h = `
      <div class="codenames-grid">
        ${
          (gs.words || []).map((w, i) => `
            <button
              class="word-card"
              onclick="sendGameMove('${room.id}',{type:'guess',index:${i}})"
            >
              ${esc(w)}
            </button>
          `).join("")
        }
      </div>

      <div class="game-actions">
        <button
          class="primary"
          onclick="sendGameMove('${room.id}',{type:'clue',text:prompt('التلميح')||'',count:Number(prompt('عدد الكلمات'))||0})"
        >
          إعطاء تلميح
        </button>
      </div>
    `;
  } else if (game === "مافيا") {
    h = `
      <div class="generic-game">
        <h2>
          المرحلة:
          ${esc(gs.phase || "ليل")}
        </h2>

        <p>
          دورك وصلاحيتك يحددها السيرفر.
        </p>

        <button
          class="primary"
          onclick="sendGameMove('${room.id}',{type:${gs.phase === "night" ? "'kill'" : "'vote'"},target:prompt('اسم اللاعب')||''})"
        >
          ${gs.phase === "night"
            ? "اختيار هدف"
            : "التصويت"}
        </button>
      </div>
    `;
  } else if (game === "مونوبولي") {
    h = `
      <div class="generic-game">
        <h2>
          رصيدك:
          ${esc(
            String(
              gs.money?.[window.__meUsername] ??
              1500
            )
          )}
        </h2>

        <p>
          الموقع:
          ${esc(
            String(
              gs.position?.[window.__meUsername] ??
              0
            )
          )}
        </p>

        <button
          class="primary"
          onclick="sendGameMove('${room.id}',{type:'roll'})"
        >
          رمي النرد
        </button>

        <button
          class="primary"
          onclick="sendGameMove('${room.id}',{type:'buy'})"
        >
          شراء الموقع
        </button>
      </div>
    `;
  } else if (
    game === "لودو" ||
    game === "جاكارو"
  ) {
    h = `
      <div class="card-table board-game">
        <h2>${esc(game)}</h2>

        <p>
          النرد:
          ${esc(String(gs.dice || "-"))}
        </p>

        <button
          class="primary"
          onclick="sendGameMove('${room.id}',{type:'roll'})"
        >
          رمي النرد
        </button>

        <div class="piece-actions">
          ${
            [0, 1, 2, 3].map(i => `
              <button
                onclick="sendGameMove('${room.id}',{type:'move',piece:${i}})"
              >
                تحريك حجر ${i + 1}
              </button>
            `).join("")
          }
        </div>
      </div>
    `;
  } else if (game === "رووليت") {
    h = `
      <div class="generic-game">
        <h2>روليت</h2>

        <button
          class="primary"
          onclick="sendGameMove('${room.id}',{type:'bet',choice:prompt('الاختيار')||'red',amount:Number(prompt('المبلغ'))||1})"
        >
          ضع اختيارك
        </button>
      </div>
    `;
  } else {
    h = `
      <div class="generic-game">
        <h2>${esc(game)}</h2>
      </div>
    `;
  }

  ui.innerHTML = h;
}

async function openGameRoom(roomId, game) {
  const d = await apiRequest(
    "/api/platform/rooms/" +
      roomId +
      "/state"
  ).catch(() => null);

  const room =
    d?.room ||
    {
      id: roomId,
      title: game,
      participants: [],
      spectators: [],
      maxPlayers:
        GAME_CATALOG[game]?.max || 12
    };

  const device = deviceClass();

  title.textContent = game;

  subtitle.textContent =
    "اخترنا مقاس الطاولة حسب جهازك: " +
    device;

  content.className = "platform-view";

  content.innerHTML =
    gameShell(room, game, device);

  const stage =
    document.querySelector(".game-stage");

  if (stage) {
    stage.setAttribute(
      "data-game",
      game
    );
  }

  window.__activeGame = game;
  window.__meUsername =
    window.__meUsername || "";

  renderGameBoard(game, room);

  const expand = $("#game-expand");

  if (expand) {
    expand.onclick = () => {
      $("#mld-game-board")
        .classList.toggle("expanded");
    };
  }

  const exitExpanded =
    $("#game-exit-expanded");

  if (exitExpanded) {
    exitExpanded.onclick = () => {
      $("#mld-game-board")
        .classList.remove("expanded");
    };
  }

  const leave = $("#game-leave");

  if (leave) {
    leave.onclick = async () => {
      try {
        await apiRequest(
          "/api/platform/rooms/" +
            roomId +
            "/leave",
          {
            method: "POST",
            body: "{}"
          }
        );

        activeConversationId = null;

        await change("games");
      } catch (err) {
        setStatus(err.message);
      }
    };
  }

  const end = $("#game-end");

  if (end) {
    end.onclick = async () => {
      try {
        await apiRequest(
          "/api/platform/rooms/" +
            roomId +
            "/action",
          {
            method: "POST",
            body: JSON.stringify({
              action: "end"
            })
          }
        );

        await change("games");
      } catch (err) {
        setStatus(err.message);
      }
    };
  }

  const ready = $("#game-ready");

  if (ready) {
    ready.onclick = async () => {
      try {
        await apiRequest(
          "/api/platform/rooms/" +
            roomId +
            "/action",
          {
            method: "POST",
            body: JSON.stringify({
              action: "ready"
            })
          }
        );

        setStatus(
          "تم تسجيل جاهزيتك ✓"
        );
      } catch (err) {
        setStatus(err.message);
      }
    };
  }

  const start = $("#game-start");

  if (start) {
    start.onclick = async () => {
      try {
        await apiRequest(
          "/api/platform/rooms/" +
            roomId +
            "/action",
          {
            method: "POST",
            body: JSON.stringify({
              action: "start"
            })
          }
        );

        setStatus("بدأت الجولة ✓");

        await openGameRoom(
          roomId,
          game
        );
      } catch (err) {
        setStatus(err.message);
      }
    };
  }
}

async function renderPlatformView(v) {
  if (searchWrap) {
    searchWrap.style.display = "none";
  }

  const cfg = {
    chat: [
      "الشات العام",
      "محادثة المجتمع العامة"
    ],

    conversations: [
      "محادثاتي",
      "محادثات خاصة وفردية وجماعية"
    ],

    jokes: [
      "النكت",
      "شارك نكتة"
    ],

    vent: [
      "فضفضة",
      "مساحة للمشاركة والتعبير"
    ],

    stories: [
      "القصص والمواقف",
      "شارك قصة أو موقفًا"
    ],

    games: [
      "جلسات الألعاب",
      "أنشئ جلسة أو انضم لجلسة مفتوحة"
    ],

    groups: [
      "القروبات",
      "طلبات القروبات مرتبطة بموافقة الإدارة"
    ],

    tickets: [
      "التذاكر",
      "افتح طلب دعم وتابع طلباتك"
    ],

    applications: [
      "التقديم للإدارة",
      "قدّم طلبك وتابع حالته"
    ]
  };

  title.textContent = cfg[v][0];
  subtitle.textContent = cfg[v][1];

  content.className = "platform-view";

  const endpoint = {
    chat: "chat",
    jokes: "jokes",
    vent: "vent",
    stories: "stories"
  }[v];

  try {
    if (endpoint) {
      const [d, me] =
        await Promise.all([
          apiRequest(
            "/api/platform/" +
              endpoint
          ),

          apiRequest(
            "/api/auth/me"
          ).catch(() => ({}))
        ]);

      content.innerHTML = `
        <div class="platform-card">
          <form id="platform-form">
            <textarea
              id="platform-text"
              class="full"
              maxlength="3000"
              placeholder="${
                v === "chat"
                  ? "اكتب رسالة عامة..."
                  : v === "jokes"
                    ? "اكتب نكتتك..."
                    : v === "vent"
                      ? "اكتب فضفضتك..."
                      : "اكتب قصتك أو موقفك..."
              }"
              required
            ></textarea>

            <button class="primary wide">
              نشر
            </button>

            <p
              id="platform-status"
              class="muted"
            ></p>
          </form>

          <div class="platform-feed"></div>
        </div>
      `;

      const feed =
        content.querySelector(
          ".platform-feed"
        );

      const items =
        d.messages ||
        d.items ||
        [];

      feed.innerHTML =
        items.map(x => `
          <article class="feed-card">
            <b>
              ${esc(
                x.user?.displayName ||
                x.user?.username ||
                "عضو"
              )}
            </b>

            <small class="muted">
              · ${esc(
                x.user?.role ||
                "عضو"
              )}
            </small>

            <p>
              ${esc(x.text)}
            </p>

            <small class="muted">
              ${new Date(
                x.createdAt
              ).toLocaleString("ar-SA")}
            </small>

            ${
              endpoint === "chat" &&
              me.user &&
              (
                me.user.role === "owner" ||
                me.user.username ===
                  x.user?.username
              )
                ? `
                  <button
                    class="primary delete-public"
                    data-delete-public="${esc(x.id)}"
                  >
                    حذف الرسالة
                  </button>
                `
                : ""
            }
          </article>
        `).join("")
        ||
        `<p class="muted">
          ما فيه مشاركات للحين.
        </p>`;

      content
        .querySelectorAll(
          "[data-delete-public]"
        )
        .forEach(b => {
          b.onclick = async () => {
            try {
              await apiRequest(
                "/api/platform/chat/" +
                  b.dataset.deletePublic,
                {
                  method: "DELETE"
                }
              );

              await renderPlatformView(v);
            } catch (err) {
              $("#platform-status").textContent =
                err.message;
            }
          };
        });

      $("#platform-form").onsubmit =
        async e => {
          e.preventDefault();

          try {
            await apiRequest(
              "/api/platform/" +
                endpoint,
              {
                method: "POST",
                body: JSON.stringify({
                  text:
                    $("#platform-text")
                      .value
                })
              }
            );

            await renderPlatformView(v);
          } catch (err) {
            $("#platform-status")
              .textContent =
                err.message;
          }
        };

      return;
    }

    if (
      v === "games" ||
      v === "cinema"
    ) {
      const d = await apiRequest(
        "/api/platform/rooms"
      );

      content.innerHTML = `
        <div class="platform-card">
          <h3>
            إنشاء ${
              v === "games"
                ? "جلسة لعبة"
                : "غرفة مشاهدة"
            }
          </h3>

          <input
            id="room-title"
            class="full"
            placeholder="اسم الجلسة أو الغرفة"
          >

          ${
            v === "games"
              ? `
                <label class="field-label">
                  اختر اللعبة
                </label>

                <select
                  id="room-game"
                  class="full"
                >
                  ${
                    Object.keys(
                      GAME_CATALOG
                    ).map(name => `
                      <option
                        value="${esc(name)}"
                      >
                        ${esc(name)}
                        ·
                        ${GAME_CATALOG[name].min}
                        -
                        ${GAME_CATALOG[name].max}
                        لاعبين
                      </option>
                    `).join("")
                  }
                </select>

                <p
                  id="game-desc"
                  class="muted"
                ></p>
              `
              : `
                <input
                  id="room-game"
                  class="full"
                  placeholder="رابط رسمي للمحتوى المرخّص"
                >
              `
          }

          <button
            id="room-create"
            class="primary wide"
          >
            إنشاء
          </button>

          <p
            id="platform-status"
            class="muted"
          ></p>

          <h3>الجلسات المفتوحة</h3>

          <div class="platform-feed"></div>
        </div>
      `;

      const list =
        (d.rooms || [])
          .filter(
            r =>
              r.type ===
              (
                v === "games"
                  ? "game"
                  : "cinema"
              )
          );

      content.querySelector(
        ".platform-feed"
      ).innerHTML =
        list.map(r => `
          <article class="feed-card">
            <b>${esc(r.title)}</b>

            <p>
              ${
                v === "cinema" &&
                /^https:\/\//i.test(
                  r.game || ""
                )
                  ? `
                    <a
                      href="${esc(r.game)}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      فتح المصدر المرخّص
                    </a>
                  `
                  : esc(r.game || "")
              }

              · ${esc(r.owner)}
              · ${r.participantsCount}
              مشاركين
            </p>

            <button
              class="primary"
              data-join="${esc(r.id)}"
            >
              انضمام كلاعب
            </button>

            <button
              class="primary"
              data-spectate="${esc(r.id)}"
            >
              مشاهدة
            </button>
          </article>
        `).join("")
        ||
        `<p class="muted">
          لا توجد جلسات مفتوحة.
        </p>`;

      $("#room-create").onclick =
        async () => {
          try {
            await apiRequest(
              "/api/platform/rooms",
              {
                method: "POST",
                body: JSON.stringify({
                  type:
                    v === "games"
                      ? "game"
                      : "cinema",
                  title:
                    $("#room-title").value,
                  game:
                    $("#room-game").value
                })
              }
            );

            await renderPlatformView(v);
          } catch (err) {
            $("#platform-status")
              .textContent =
                err.message;
          }
        };

      content
        .querySelectorAll(
          "[data-join]"
        )
        .forEach(b => {
          b.onclick = async () => {
            try {
              const rr =
                await apiRequest(
                  "/api/platform/rooms/" +
                    b.dataset.join +
                    "/join",
                  {
                    method: "POST",
                    body: JSON.stringify({
                      mode: "player"
                    })
                  }
                );

              await openGameRoom(
                rr.room.id,
                rr.room.game ||
                  "أونو"
              );
            } catch (err) {
              $("#platform-status")
                .textContent =
                  err.message;
            }
          };
        });

      content
        .querySelectorAll(
          "[data-spectate]"
        )
        .forEach(b => {
          b.onclick = async () => {
            try {
              const rr =
                await apiRequest(
                  "/api/platform/rooms/" +
                    b.dataset.spectate +
                    "/join",
                  {
                    method: "POST",
                    body: JSON.stringify({
                      mode: "spectator"
                    })
                  }
                );

              if (v === "games") {
                await openGameRoom(
                  rr.room.id,
                  rr.room.game ||
                    "أونو"
                );
              } else {
                $("#platform-status")
                  .textContent =
                    "دخلت كمشاهد ✓";

                await renderPlatformView(
                  v
                );
              }
            } catch (err) {
              $("#platform-status")
                .textContent =
                  err.message;
            }
          };
        });

      return;
    }

    if (v === "conversations") {
      const [cd, ud] =
        await Promise.all([
          apiRequest(
            "/api/platform/conversations"
          ),

          apiRequest(
            "/api/platform/users"
          )
        ]);

      content.innerHTML = `
        <div class="platform-card">
          <h3>محادثة جديدة</h3>

          <input
            id="conv-title"
            class="full"
            placeholder="اسم المحادثة (اختياري)"
          >

          <select
            id="conv-users"
            class="full"
            multiple
            size="5"
          >
            ${
              (ud.users || []).map(u => `
                <option
                  value="${esc(u.username)}"
                >
                  ${esc(
                    u.displayName ||
                    u.username
                  )}
                  (@${esc(u.username)})
                </option>
              `).join("")
            }
          </select>

          <button
            id="conv-create"
            class="primary wide"
          >
            إنشاء
          </button>

          <p
            id="platform-status"
            class="muted"
          ></p>

          <div class="platform-feed">
            ${
              (cd.conversations || [])
                .map(c => `
                  <article class="feed-card">
                    <b>${esc(c.title)}</b>

                    <p class="muted">
                      المالك
                      ${esc(c.owner)}
                      ·
                      ${c.members.length}
                      مشاركين
                    </p>

                    <button
                      class="primary"
                      data-conv="${esc(c.id)}"
                    >
                      فتح
                    </button>
                  </article>
                `).join("")
            }
          </div>

          <div id="conv-detail"></div>
        </div>
      `;

      $("#conv-create").onclick =
        async () => {
          try {
            await apiRequest(
              "/api/platform/conversations",
              {
                method: "POST",
                body: JSON.stringify({
                  title:
                    $("#conv-title")
                      .value,

                  members: [
                    ...$("#conv-users")
                      .selectedOptions
                  ].map(o => o.value)
                })
              }
            );

            await renderPlatformView(v);
          } catch (err) {
            $("#platform-status")
              .textContent =
                err.message;
          }
        };

      content
        .querySelectorAll(
          "[data-conv]"
        )
        .forEach(b => {
          b.onclick = () =>
            openConversation(
              b.dataset.conv
            );
        });

      return;
    }

    if (v === "tickets") {
      const d =
        await apiRequest(
          "/api/platform/tickets"
        );

      content.innerHTML = `
        <div class="platform-card">
          <form id="platform-form">
            <input
              id="ticket-title"
              class="full"
              placeholder="عنوان التذكرة"
              required
            >

            <textarea
              id="ticket-text"
              class="full"
              placeholder="تفاصيل طلبك"
              required
            ></textarea>

            <button
              class="primary wide"
            >
              فتح تذكرة
            </button>

            <p
              id="platform-status"
              class="muted"
            ></p>
          </form>

          <div class="platform-feed">
            ${
              (d.tickets || []).map(t => `
                <article class="feed-card">
                  <b>${esc(t.title)}</b>

                  <p>
                    ${esc(t.status)}
                    ·
                    ${esc(t.owner)}
                  </p>

                  <button
                    class="primary ticket-open"
                    data-ticket-open="${esc(t.id)}"
                  >
                    فتح المحادثة
                  </button>
                </article>
              `).join("")
            }
          </div>

          <div id="ticket-detail"></div>
        </div>
      `;

      content
        .querySelectorAll(
          "[data-ticket-open]"
        )
        .forEach(b => {
          b.onclick = () =>
            openTicket(
              b.dataset.ticketOpen
            );
        });

      $("#platform-form").onsubmit =
        async e => {
          e.preventDefault();

          try {
            await apiRequest(
              "/api/platform/tickets",
              {
                method: "POST",
                body: JSON.stringify({
                  title:
                    $("#ticket-title")
                      .value,

                  text:
                    $("#ticket-text")
                      .value
                })
              }
            );

            await renderPlatformView(v);
          } catch (err) {
            $("#platform-status")
              .textContent =
                err.message;
          }
        };

      return;
    }

    if (v === "applications") {
      const d =
        await apiRequest(
          "/api/platform/applications"
        );

      content.innerHTML = `
        <div class="platform-card">
          <form id="platform-form">
            <input
              id="application-discord"
              class="full"
              placeholder="يوزر ديسكورد"
              required
            >

            <textarea
              id="application-answers"
              class="full"
              placeholder="اكتب إجاباتك وخبراتك"
              required
            ></textarea>

            <button
              class="primary wide"
            >
              إرسال التقديم
            </button>

            <p
              id="platform-status"
              class="muted"
            ></p>
          </form>

          <div class="platform-feed">
            ${
              (d.applications || []).map(a => `
                <article class="feed-card">
                  <b>
                    طلب ${esc(a.owner)}
                  </b>

                  <p>
                    الحالة:
                    ${esc(a.status)}
                  </p>
                </article>
              `).join("")
            }
          </div>
        </div>
      `;

      $("#platform-form").onsubmit =
        async e => {
          e.preventDefault();

          try {
            await apiRequest(
              "/api/platform/applications",
              {
                method: "POST",
                body: JSON.stringify({
                  discordUsername:
                    $("#application-discord")
                      .value,

                  answers:
                    $("#application-answers")
                      .value
                })
              }
            );

            await renderPlatformView(v);
          } catch (err) {
            $("#platform-status")
              .textContent =
                err.message;
          }
        };

      return;
    }

    if (v === "groups") {
      const [gd, me] =
        await Promise.all([
          apiRequest(
            "/api/platform/groups"
          ),

          apiRequest(
            "/api/auth/me"
          )
        ]);

      content.innerHTML = `
        <div class="platform-card">
          <h3>
            طلب إنشاء قروب ديسكورد
          </h3>

          <form id="group-form">
            <input
              id="group-name"
              class="full"
              maxlength="60"
              placeholder="اسم القروب"
              required
            >

            <textarea
              id="group-description"
              class="full"
              maxlength="500"
              placeholder="وصف القروب"
            ></textarea>

            <button
              class="primary wide"
            >
              إرسال للإدارة
            </button>

            <p
              id="platform-status"
              class="muted"
            ></p>
          </form>

          <h3>القروبات والطلبات</h3>

          <div class="platform-feed">
            ${
              (gd.groups || []).map(g => `
                <article class="feed-card">
                  <b>${esc(g.name)}</b>

                  <p>
                    ${esc(
                      g.description ||
                      "بدون وصف"
                    )}
                  </p>

                  <p class="muted">
                    المالك:
                    ${esc(g.owner)}
                    ·
                    ${esc(g.status)}
                  </p>

                  ${
                    me.user &&
                    ["owner", "admin"].includes(
                      me.user.role
                    ) &&
                    g.status === "pending"
                      ? `
                        <button
                          class="primary group-decision"
                          data-group="${esc(g.id)}"
                          data-state="approved"
                        >
                          قبول وإنشاء القنوات
                        </button>

                        <button
                          class="primary group-decision"
                          data-group="${esc(g.id)}"
                          data-state="rejected"
                        >
                          رفض
                        </button>
                      `
                      : ""
                  }
                </article>
              `).join("")
              ||
              `
                <p class="muted">
                  لا توجد قروبات أو طلبات حتى الآن.
                </p>
              `
            }
          </div>
        </div>
      `;

      $("#group-form").onsubmit =
        async e => {
          e.preventDefault();

          try {
            await apiRequest(
              "/api/platform/groups",
              {
                method: "POST",
                body: JSON.stringify({
                  name:
                    $("#group-name")
                      .value,

                  description:
                    $("#group-description")
                      .value
                })
              }
            );

            await renderPlatformView(v);
          } catch (err) {
            $("#platform-status")
              .textContent =
                err.message;
          }
        };

      content
        .querySelectorAll(
          ".group-decision"
        )
        .forEach(b => {
          b.onclick = async () => {
            try {
              await apiRequest(
                "/api/platform/groups/" +
                  b.dataset.group,
                {
                  method: "PATCH",
                  body: JSON.stringify({
                    status:
                      b.dataset.state
                  })
                }
              );

              await renderPlatformView(v);
            } catch (err) {
              setStatus(err.message);
            }
          };
        });

      return;
    }
  } catch (err) {
    content.innerHTML = `
      <div class="platform-card">
        <h3>تعذر تحميل القسم</h3>
        <p class="muted">
          ${esc(err.message)}
        </p>
      </div>
    `;
  }
}

async function openTicket(id) {
  const d =
    await apiRequest(
      "/api/platform/tickets/" +
        id
    );

  const t = d.ticket;
  const target = $("#ticket-detail");

  if (!target) return;

  target.innerHTML = `
    <div class="platform-card">
      <h3>${esc(t.title)}</h3>

      <p>${esc(t.text)}</p>

      <p class="muted">
        الحالة:
        ${esc(t.status)}
      </p>

      <div class="platform-feed">
        ${
          (t.messages || []).map(m => `
            <article class="feed-card">
              <b>
                ${esc(
                  m.user?.displayName ||
                  m.user?.username
                )}
              </b>

              <p>
                ${esc(m.text)}
              </p>

              <small class="muted">
                ${new Date(
                  m.createdAt
                ).toLocaleString("ar-SA")}
              </small>
            </article>
          `).join("")
        }
      </div>

      <form id="ticket-reply-form">
        <textarea
          id="ticket-reply-text"
          class="full"
          required
          placeholder="اكتب ردًا على التذكرة"
        ></textarea>

        <button
          class="primary wide"
        >
          إرسال الرد
        </button>
      </form>
    </div>
  `;

  $("#ticket-reply-form").onsubmit =
    async e => {
      e.preventDefault();

      try {
        await apiRequest(
          "/api/platform/tickets/" +
            id +
            "/reply",
          {
            method: "POST",
            body: JSON.stringify({
              text:
                $("#ticket-reply-text")
                  .value
            })
          }
        );

        await openTicket(id);
      } catch (err) {
        target.insertAdjacentHTML(
          "beforeend",
          `
            <p class="muted">
              ${esc(err.message)}
            </p>
          `
        );
      }
    };
}

async function openConversation(id) {
  activeConversationId = id;

  const [
    d,
    cd,
    me,
    ud
  ] = await Promise.all([
    apiRequest(
      "/api/platform/conversations/" +
        id +
        "/messages"
    ),

    apiRequest(
      "/api/platform/conversations"
    ),

    apiRequest(
      "/api/auth/me"
    ),

    apiRequest(
      "/api/platform/users"
    )
  ]);

  const conv =
    (cd.conversations || [])
      .find(x => x.id === id);

  const target =
    $("#conv-detail");

  if (!target) return;

  const canManage = Boolean(
    me.user &&
    (
      me.user.role === "owner" ||
      conv?.owner ===
        me.user.username
    )
  );

  target.innerHTML = `
    <div class="platform-card">
      <h3>
        ${esc(
          conv?.title ||
          "المحادثة"
        )}
      </h3>

      <p class="muted">
        المالك:
        ${esc(conv?.owner || "")}
        · المشاركون:
        ${esc(
          (conv?.members || [])
            .join("، ")
        )}
      </p>

      <div class="platform-feed">
        ${
          (d.messages || []).map(m => `
            <article class="feed-card">
              <b>
                ${esc(
                  m.user?.displayName ||
                  m.user?.username
                )}
              </b>

              <p>
                ${esc(m.text)}
              </p>

              <small class="muted">
                ${new Date(
                  m.createdAt
                ).toLocaleString("ar-SA")}
              </small>

              ${
                me.user &&
                (
                  me.user.role === "owner" ||
                  m.user?.username ===
                    me.user.username ||
                  canManage
                )
                  ? `
                    <button
                      class="primary private-delete"
                      data-delete-message="${esc(m.id)}"
                    >
                      حذف الرسالة
                    </button>
                  `
                  : ""
              }
            </article>
          `).join("")
        }
      </div>

      <form id="conv-message-form">
        <textarea
          id="conv-message"
          class="full"
          required
          placeholder="رسالة خاصة"
        ></textarea>

        <button
          class="primary wide"
        >
          إرسال
        </button>
      </form>

      ${
        canManage
          ? `
            <hr>

            <h3>
              إدارة المشاركين
            </h3>

            <select
              id="conv-add-user"
              class="full"
            >
              ${
                (ud.users || [])
                  .filter(
                    u =>
                      !(conv?.members || [])
                        .includes(
                          u.username
                        )
                  )
                  .map(u => `
                    <option
                      value="${esc(u.username)}"
                    >
                      ${esc(
                        u.displayName ||
                        u.username
                      )}
                    </option>
                  `).join("")
              }
            </select>

            <button
              id="conv-add-member"
              class="primary wide"
            >
              إضافة مشارك
            </button>

            <div class="platform-feed">
              ${
                (conv?.members || [])
                  .filter(
                    x =>
                      x !== conv?.owner
                  )
                  .map(x => `
                    <article class="feed-card">
                      ${esc(x)}

                      <button
                        class="primary conv-remove"
                        data-remove-user="${esc(x)}"
                      >
                        طرد من المحادثة
                      </button>
                    </article>
                  `).join("")
              }
            </div>
          `
          : ""
      }
    </div>
  `;

  target
    .querySelectorAll(
      "[data-delete-message]"
    )
    .forEach(b => {
      b.onclick = async () => {
        try {
          await apiRequest(
            "/api/platform/conversations/" +
              id +
              "/messages/" +
              b.dataset.deleteMessage,
            {
              method: "DELETE"
            }
          );

          await openConversation(id);
        } catch (err) {
          target.insertAdjacentHTML(
            "beforeend",
            `
              <p class="muted">
                ${esc(err.message)}
              </p>
            `
          );
        }
      };
    });

  $("#conv-message-form").onsubmit =
    async e => {
      e.preventDefault();

      try {
        await apiRequest(
          "/api/platform/conversations/" +
            id +
            "/messages",
          {
            method: "POST",
            body: JSON.stringify({
              text:
                $("#conv-message")
                  .value
            })
          }
        );

        await openConversation(id);
      } catch (err) {
        target.insertAdjacentHTML(
          "beforeend",
          `
            <p class="muted">
              ${esc(err.message)}
            </p>
          `
        );
      }
    };

  const add =
    $("#conv-add-member");

  if (add) {
    add.onclick = async () => {
      try {
        await apiRequest(
          "/api/platform/conversations/" +
            id +
            "/members",
          {
            method: "POST",
            body: JSON.stringify({
              username:
                $("#conv-add-user")
                  .value
            })
          }
        );

        await openConversation(id);
      } catch (err) {
        target.insertAdjacentHTML(
          "beforeend",
          `
            <p class="muted">
              ${esc(err.message)}
            </p>
          `
        );
      }
    };
  }

  target
    .querySelectorAll(
      "[data-remove-user]"
    )
    .forEach(b => {
      b.onclick = async () => {
        try {
          await apiRequest(
            "/api/platform/conversations/" +
              id +
              "/members/" +
              encodeURIComponent(
                b.dataset.removeUser
              ),
            {
              method: "DELETE"
            }
          );

          await openConversation(id);
        } catch (err) {
          target.insertAdjacentHTML(
            "beforeend",
            `
              <p class="muted">
                ${esc(err.message)}
              </p>
            `
          );
        }
      };
    });
}

async function renderHub() {
  if (searchWrap) {
    searchWrap.style.display = "none";
  }

  title.textContent = "مركز MALADH";

  subtitle.textContent =
    "مركز المجتمع الذكي: فعاليات، تصويتات، اقتراحات وإنجازات.";

  content.className = "platform-view";

  content.innerHTML = `
    <div class="feature-grid">

      <article class="feature-card">
        <div class="feature-icon">◉</div>
        <p class="eyebrow">COMMUNITY PULSE</p>
        <h3>التصويتات</h3>
        <p class="muted">
          شارك في قرارات المجتمع وشاهد النتائج مباشرة.
        </p>
        <button
          class="primary feature-btn"
          id="hub-polls"
        >
          فتح التصويتات
        </button>
      </article>

      <article class="feature-card">
        <div class="feature-icon">✦</div>
        <p class="eyebrow">EVENTS</p>
        <h3>الفعاليات</h3>
        <p class="muted">
          مواعيد بطولات، ليالي ألعاب، ومناسبات MALADH.
        </p>
        <button
          class="primary feature-btn"
          id="hub-events"
        >
          فتح الفعاليات
        </button>
      </article>

      <article class="feature-card">
        <div class="feature-icon">⌁</div>
        <p class="eyebrow">IDEAS</p>
        <h3>الاقتراحات</h3>
        <p class="muted">
          اقترح ميزة أو فعالية وصوّت على أفكار المجتمع.
        </p>
        <button
          class="primary feature-btn"
          id="hub-ideas"
        >
          فتح الاقتراحات
        </button>
      </article>

      <article class="feature-card">
        <div class="feature-icon">♛</div>
        <p class="eyebrow">ACHIEVEMENTS</p>
        <h3>الإنجازات</h3>
        <p class="muted">
          هوية وتقدم للمستخدمين بناءً على مشاركتهم في المنصة.
        </p>
        <button
          class="primary feature-btn"
          id="hub-achievements"
        >
          عرض الإنجازات
        </button>
      </article>

    </div>

    <div
      id="hub-panel"
      class="platform-card"
    >
      <p class="muted">
        اختر وحدة من الأعلى.
      </p>
    </div>
  `;

  const panel = $("#hub-panel");

  $("#hub-polls").onclick =
    async () => {
      const d =
        await apiRequest(
          "/api/platform/hub/polls"
        );

      panel.innerHTML = `
        <h3>التصويتات الحالية</h3>

        ${
          (d.items || []).map(p => `
            <article class="feed-card">
              <b>${esc(p.question)}</b>

              <div class="hub-options">
                ${
                  p.options.map((o, i) => `
                    <button
                      class="primary hub-vote"
                      data-poll="${esc(p.id)}"
                      data-option="${i}"
                    >
                      ${esc(o)}
                      ·
                      ${p.votes[i]}
                    </button>
                  `).join("")
                }
              </div>

              <small class="muted">
                إجمالي الأصوات:
                ${p.votes.reduce(
                  (a, b) => a + b,
                  0
                )}
              </small>
            </article>
          `).join("")
          ||
          `<p class="muted">
            لا توجد تصويتات حاليًا.
          </p>`
        }
      `;

      panel
        .querySelectorAll(".hub-vote")
        .forEach(b => {
          b.onclick = async () => {
            try {
              await apiRequest(
                "/api/platform/hub/polls/" +
                  b.dataset.poll +
                  "/vote",
                {
                  method: "POST",
                  body: JSON.stringify({
                    option:
                      Number(
                        b.dataset.option
                      )
                  })
                }
              );

              await $("#hub-polls")
                .onclick();
            } catch (e) {
              setStatus(e.message);
            }
          };
        });
    };

  $("#hub-events").onclick =
    async () => {
      const d =
        await apiRequest(
          "/api/platform/hub/events"
        );

      panel.innerHTML = `
        <h3>فعاليات MALADH</h3>

        ${
          (d.items || []).map(e => `
            <article class="feed-card">
              <b>${esc(e.title)}</b>

              <p>
                ${esc(e.description)}
              </p>

              <span class="member-tag">
                ${esc(
                  new Date(
                    e.startsAt
                  ).toLocaleString("ar-SA")
                )}
              </span>
            </article>
          `).join("")
          ||
          `<p class="muted">
            لا توجد فعاليات مجدولة.
          </p>`
        }
      `;
    };

  $("#hub-ideas").onclick =
    async () => {
      const d =
        await apiRequest(
          "/api/platform/hub/ideas"
        );

      panel.innerHTML = `
        <h3>اقتراحات المجتمع</h3>

        <form id="idea-form">
          <input
            id="idea-title"
            class="full"
            maxlength="120"
            placeholder="عنوان الاقتراح"
          >

          <textarea
            id="idea-text"
            class="full"
            maxlength="1000"
            placeholder="وش الفكرة؟"
          ></textarea>

          <button class="primary">
            إرسال الاقتراح
          </button>
        </form>

        ${
          (d.items || []).map(i => `
            <article class="feed-card">
              <b>${esc(i.title)}</b>

              <p>
                ${esc(i.text)}
              </p>

              <small class="muted">
                ${esc(
                  i.user?.displayName ||
                  i.user?.username ||
                  ""
                )}
                · 👍 ${i.votes}
              </small>

              <button
                class="primary hub-idea-vote"
                data-idea="${esc(i.id)}"
              >
                تصويت
              </button>
            </article>
          `).join("")
        }
      `;

      $("#idea-form").onsubmit =
        async e => {
          e.preventDefault();

          try {
            await apiRequest(
              "/api/platform/hub/ideas",
              {
                method: "POST",
                body: JSON.stringify({
                  title:
                    $("#idea-title")
                      .value,

                  text:
                    $("#idea-text")
                      .value
                })
              }
            );

            await $("#hub-ideas")
              .onclick();
          } catch (err) {
            setStatus(err.message);
          }
        };

      panel
        .querySelectorAll(
          ".hub-idea-vote"
        )
        .forEach(b => {
          b.onclick = async () => {
            try {
              await apiRequest(
                "/api/platform/hub/ideas/" +
                  b.dataset.idea +
                  "/vote",
                {
                  method: "POST"
                }
              );

              await $("#hub-ideas")
                .onclick();
            } catch (e) {
              setStatus(e.message);
            }
          };
        });
    };

  $("#hub-achievements").onclick =
    async () => {
      const d =
        await apiRequest(
          "/api/platform/hub/achievements"
        );

      panel.innerHTML = `
        <h3>إنجازات المجتمع</h3>

        <div class="top-grid">
          ${
            (d.items || []).map(a => `
              <article class="top-card">
                <span class="rank">★</span>

                <div>
                  <h4>
                    ${esc(
                      a.user.displayName ||
                      a.user.username
                    )}
                  </h4>

                  <small>
                    ${esc(a.badge)}
                  </small>
                </div>

                <strong>
                  ${a.points}
                </strong>
              </article>
            `).join("")
          }
        </div>
      `;
    };
}

async function change(v) {
  view = v;

  document.body.classList.toggle(
    "mld-non-home",
    v !== "home"
  );

  if (v !== "conversations") {
    activeConversationId = null;
  }

  if (mobile) {
    mobile.classList.remove("open");
  }

  document
    .querySelectorAll(".menu-item")
    .forEach(b => {
      b.classList.toggle(
        "active",
        b.dataset.view === v
      );
    });

  if (v === "message") {
    return messageView();
  }

  if (v === "hub") {
    return renderHub();
  }

  if (v === "bots") {
    return renderBots();
  }

  if (v === "home") {
    await renderReviews();
    return refresh();
  }

  if (
    v === "members" ||
    v === "roles" ||
    v === "top"
  ) {
    if (searchWrap) {
      searchWrap.style.display =
        v === "members"
          ? "flex"
          : "none";
    }

    title.textContent =
      v === "members"
        ? "أعضاء المجتمع"
        : v === "roles"
          ? "الرتب القيادية الست"
          : "لوحة TOP";

    if (
      v === "members" ||
      v === "roles"
    ) {
      return refresh();
    }

    renderTop(
      await fetch(
        "/api/public/top"
      ).then(r => r.json())
    );

    setStatus(
      "تحديث مباشر للنشاط"
    );

    return;
  }

  const cinemaCatalog = [
    ["The Last of Us","مسلسل","2023","دراما · بقاء"],
    ["Wednesday","مسلسل","2022","غموض · كوميديا"],
    ["Stranger Things","مسلسل","2016","خيال · مغامرة"],
    ["Breaking Bad","مسلسل","2008","جريمة · دراما"],
    ["Better Call Saul","مسلسل","2015","جريمة · دراما"],
    ["The Boys","مسلسل","2019","أكشن · أبطال"],
    ["Arcane","مسلسل","2021","أنيميشن · فانتازيا"],
    ["Dark","مسلسل","2017","غموض · خيال علمي"],
    ["Peaky Blinders","مسلسل","2013","جريمة · تاريخي"],
    ["The Office","مسلسل","2005","كوميديا"],
    ["Friends","مسلسل","1994","كوميديا"],
    ["The Bear","مسلسل","2022","دراما · طبخ"],
    ["Squid Game","مسلسل","2021","إثارة · دراما"],
    ["Money Heist","مسلسل","2017","جريمة · إثارة"],
    ["Sherlock","مسلسل","2010","غموض · تحقيق"],
    ["Interstellar","فيلم","2014","خيال علمي · دراما"],
    ["Inception","فيلم","2010","خيال علمي · إثارة"],
    ["The Dark Knight","فيلم","2008","أكشن · جريمة"],
    ["Dune","فيلم","2021","خيال علمي · مغامرة"],
    ["Dune: Part Two","فيلم","2024","خيال علمي · مغامرة"],
    ["Oppenheimer","فيلم","2023","دراما · تاريخ"],
    ["Barbie","فيلم","2023","كوميديا · مغامرة"],
    ["Spider-Man: No Way Home","فيلم","2021","أكشن · أبطال"],
    ["Avengers: Endgame","فيلم","2019","أكشن · خيال"],
    ["Top Gun: Maverick","فيلم","2022","أكشن · دراما"],
    ["John Wick: Chapter 4","فيلم","2023","أكشن · إثارة"],
    ["Knives Out","فيلم","2019","غموض · كوميديا"],
    ["The Batman","فيلم","2022","أكشن · جريمة"],
    ["Guardians of the Galaxy Vol. 3","فيلم","2023","أكشن · خيال"],
    ["Inside Out 2","فيلم","2024","أنيميشن · عائلي"]
  ];

  function renderCinema() {
    if (searchWrap) {
      searchWrap.style.display = "none";
    }

    title.textContent = "السينما";

    subtitle.textContent =
      "قائمة كبيرة من الأفلام والمسلسلات — التشغيل يضاف فقط للمحتوى المرخّص المتاح.";

    content.className = "cinema-grid";

    content.innerHTML =
      cinemaCatalog.map((x, i) => `
        <article class="cinema-card">
          <div class="cinema-cover">
            <span>${x[1]}</span>
            <b>
              ${String(i + 1).padStart(2, "0")}
            </b>
          </div>

          <div>
            <p class="eyebrow">
              ${esc(x[2])}
              ·
              ${esc(x[3])}
            </p>

            <h3>${esc(x[0])}</h3>

            <button
              class="primary cinema-btn"
              data-title="${esc(x[0])}"
            >
              فتح التفاصيل
            </button>
          </div>
        </article>
      `).join("");

    content
      .querySelectorAll(".cinema-btn")
      .forEach(b => {
        b.onclick = () =>
          setStatus(
            "تم اختيار «" +
              b.dataset.title +
              "» — أضف مصدر تشغيل مرخّص من إدارة السينما."
          );
      });

    setStatus(
      `${cinemaCatalog.length} عمل في الكتالوج`
    );
  }

  if (
    [
      "chat",
      "conversations",
      "jokes",
      "vent",
      "stories",
      "games",
      "groups",
      "tickets",
      "applications",
      "cinema"
    ].includes(v)
  ) {
    if (v === "cinema") {
      renderCinema();
      return;
    }

    return renderPlatformView(v);
  }

  if (v === "account") {
    renderAccount();
    return;
  }

  if (v === "admin") {
    return renderAdmin();
  }

  if (v === "owner") {
    return renderAdmin();
  }

  if (names[v]) {
    if (searchWrap) {
      searchWrap.style.display = "none";
    }

    title.textContent = names[v][0];
    subtitle.textContent = names[v][1];

    content.className = "feature-grid";

    content.innerHTML =
      data[v].map((x, i) => `
        <article class="feature-card">
          <div class="feature-icon">
            ${["✦","◈","◎"][i]}
          </div>

          <p class="eyebrow">
            MALADH SYSTEM
          </p>

          <h3>${esc(x[0])}</h3>

          <p class="muted">
            ${esc(x[1])}
          </p>

          <button
            class="primary feature-btn"
            data-feature="${esc(x[0])}"
            data-section="${esc(v)}"
          >
            ${esc(x[2])}
          </button>
        </article>
      `).join("");

    content
      .querySelectorAll(".feature-btn")
      .forEach(b => {
        b.onclick = async () => {
          const section =
            b.dataset.section;

          if (section === "account") {
            return change("account");
          }

          if (section === "games") {
            return change("games");
          }

          if (section === "groups") {
            return change("groups");
          }

          if (section === "cinema") {
            return change("cinema");
          }

          if (section === "tickets") {
            return change("tickets");
          }

          if (
            section === "applications"
          ) {
            return change(
              "applications"
            );
          }

          setStatus(
            "جاري فتح الوحدة..."
          );
        };
      });

    setStatus("القسم جاهز");
  }
}

function showNavigationError(v, err) {
  console.error(
    "MALADH navigation error",
    v,
    err
  );

  if (title) {
    title.textContent =
      "تعذر فتح القسم";
  }

  if (subtitle) {
    subtitle.textContent =
      "حدث خطأ داخل هذا القسم.";
  }

  if (status) {
    status.textContent =
      err?.message ||
      "خطأ غير متوقع";
  }

  if (content) {
    content.innerHTML = `
      <div class="empty">
        <h3>تعذر فتح القسم</h3>
        <p>
          تم إيقاف الخطأ بدل الرجوع للرئيسية.
        </p>
      </div>
    `;
  }
}

async function mldNavigate(v) {
  if (!v) return;

  try {
    if (mobile) {
      mobile.classList.remove("open");
    }

    await change(v);

    history.replaceState(
      null,
      "",
      "#" + v
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  } catch (err) {
    showNavigationError(
      v,
      err
    );
  }
}

window.MLDNavigate = mldNavigate;

/*
 * إصلاح زر الثلاث خطوط بشكل مستقل.
 * حتى لو كان onclick الموجود في HTML
 * لا يعمل، هذا الربط يبقي القائمة قابلة للفتح.
 */
const menuButton =
  $("#floating-menu-button");

if (menuButton && mobile) {
  menuButton.addEventListener(
    "click",
    e => {
      e.preventDefault();
      e.stopPropagation();

      const isOpen =
        !mobile.classList.contains(
          "open"
        );

      mobile.classList.toggle(
        "open",
        isOpen
      );

      menuButton.setAttribute(
        "aria-expanded",
        String(isOpen)
      );
    }
  );
}

function routeFromHash() {
  const v =
    (location.hash || "#home")
      .slice(1) ||
    "home";

  Promise.resolve(
    change(v)
  ).catch(err =>
    showNavigationError(
      v,
      err
    )
  );
}

window.addEventListener(
  "hashchange",
  routeFromHash
);

document.addEventListener(
  "click",
  e => {
    if (
      mobile &&
      !e.target.closest(
        "#mobile-menu"
      ) &&
      !e.target.closest(
        "#floating-menu-button"
      )
    ) {
      mobile.classList.remove(
        "open"
      );
    }
  }
);

if (search) {
  search.oninput = () => {
    if (view !== "members") {
      change("members");
    }

    searchMembers();
  };
}

if ($("#close")) {
  $("#close").onclick =
    closeModal;
}

if (modal) {
  modal.onclick = e => {
    if (e.target === modal) {
      closeModal();
    }
  };
}

document.onkeydown = e => {
  if (e.key === "Escape") {
    closeModal();
  }
};

loadAnnouncement();

setInterval(
  loadAnnouncement,
  15000
);

if ($("#year")) {
  $("#year").textContent =
    new Date().getFullYear();
}

fetch("/api/auth/me")
  .then(r => r.json())
  .then(me => {
    syncAdminMenu(me);

    if (
      me?.authenticated &&
      me.user?.username
    ) {
      window.__meUsername =
        me.user.username;
    }
  })
  .catch(() => {});

routeFromHash();

reviewsTimer = setInterval(
  renderReviews,
  5000
);

refresh();

refreshTimer = setInterval(
  () => {
    if (
      modal &&
      (
        !modal.classList.contains(
          "hidden"
        ) ||
        view === "message"
      )
    ) {
      return;
    }

    refresh();
  },
  15000
);

setInterval(
  () => {
    if (
      view === "chat" &&
      document.activeElement?.id !==
        "platform-text"
    ) {
      renderPlatformView(
        "chat"
      );
    } else if (
      view === "conversations" &&
      activeConversationId &&
      ![
        "conv-message",
        "conv-add-user"
      ].includes(
        document.activeElement?.id
      )
    ) {
      openConversation(
        activeConversationId
      ).catch(() => {});
    }
  },
  5000
);
