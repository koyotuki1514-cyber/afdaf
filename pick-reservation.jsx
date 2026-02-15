import { useState, useEffect, useCallback } from "react";

// ─── Constants matching spreadsheet settings ───
const PRODUCTS = [
  { id: "quarter", name: "クォーター", requiredSlots: 1, durationMin: 60 },
  { id: "half", name: "ハーフ", requiredSlots: 3, durationMin: 120 },
  { id: "full", name: "フル", requiredSlots: 2, durationMin: 180 },
  { id: "pick-guide-half", name: "ピック指導（ハーフ）", requiredSlots: 3, durationMin: 180 },
  { id: "pick-guide-full", name: "ピック指導（フル）", requiredSlots: 2, durationMin: 240 },
];

const DEFAULT_SETTINGS = {
  maxCapacity: 6,
  openHour: 9,
  openMin: 0,
  closeHour: 19,
  closeMin: 0,
  slotIntervalMin: 30,
  calendarMonths: 3,
  holidays: [],
};

const STORAGE_KEY = "pick-reservations-v2";
const SETTINGS_KEY = "pick-settings-v2";
const DAYS_JP = ["日", "月", "火", "水", "木", "金", "土"];

// ─── Utilities ───
const genId = () => Math.random().toString(36).substr(2, 9);
const pad2 = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtTime = (h, m) => `${pad2(h)}:${pad2(m)}`;
const isToday = (s) => fmtDate(new Date()) === s;
const isPast = (s) => parseDate(s) < new Date(new Date().toDateString());

const getMonthDays = (year, month) => {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days = [];
  for (let i = 0; i < first.getDay(); i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(d);
  return days;
};

const generateTimeSlots = (settings) => {
  const slots = [];
  let h = settings.openHour, m = settings.openMin;
  const endTotal = settings.closeHour * 60 + settings.closeMin;
  while (h * 60 + m < endTotal) {
    slots.push({ hour: h, min: m, label: fmtTime(h, m) });
    m += settings.slotIntervalMin;
    if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
  }
  return slots;
};

const timeToMinutes = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const getSlotOccupancy = (date, slotLabel, reservations) => {
  return reservations
    .filter((r) => r.date === date && r.status === "confirmed")
    .reduce((sum, r) => {
      const startIdx = timeToMinutes(r.startTime);
      const endIdx = timeToMinutes(r.endTime);
      const slotMin = timeToMinutes(slotLabel);
      if (slotMin >= startIdx && slotMin < endIdx) {
        return sum + r.requiredSlots;
      }
      return sum;
    }, 0);
};

const canBook = (date, startTime, product, reservations, settings) => {
  const startMin = timeToMinutes(startTime);
  const endMin = startMin + product.durationMin;
  const closeMin = settings.closeHour * 60 + settings.closeMin;
  if (endMin > closeMin) return false;
  for (let m = startMin; m < endMin; m += settings.slotIntervalMin) {
    const slotLabel = fmtTime(Math.floor(m / 60), m % 60);
    const occ = getSlotOccupancy(date, slotLabel, reservations);
    if (occ + product.requiredSlots > settings.maxCapacity) return false;
  }
  return true;
};

const getDateAvailability = (dateStr, reservations, settings) => {
  const slots = generateTimeSlots(settings);
  let totalAvail = 0;
  for (const slot of slots) {
    const occ = getSlotOccupancy(dateStr, slot.label, reservations);
    totalAvail += Math.max(0, settings.maxCapacity - occ);
  }
  const maxPossible = slots.length * settings.maxCapacity;
  return totalAvail / maxPossible;
};

// ─── Storage ───
async function loadData(key, fallback) {
  try {
    const r = await window.storage.get(key);
    return r ? JSON.parse(r.value) : fallback;
  } catch { return fallback; }
}
async function saveData(key, data) {
  try { await window.storage.set(key, JSON.stringify(data)); }
  catch (e) { console.error("Save error:", e); }
}

// ─── Styles ───
const colors = {
  bg: "#faf6f0", card: "#fffcf8", border: "#e8ddd0", text: "#3d2b1f",
  sub: "#7c6854", accent: "#c67a4a", accentLight: "#fdf0e6", success: "#4a7c59",
  successLight: "#e6f2e8", danger: "#c0392b", dangerLight: "#fce4d6",
  warn: "#e8a835", warnLight: "#fef6e0", muted: "#bbb", sunday: "#c0392b", saturday: "#2980b9",
};

const baseInput = {
  padding: "11px 14px", border: `1px solid ${colors.border}`, borderRadius: 8,
  fontSize: 14, background: colors.card, color: colors.text, outline: "none",
  fontFamily: "inherit", transition: "border-color 0.2s", width: "100%", boxSizing: "border-box",
};

const baseBtn = {
  padding: "12px 18px", border: "none", borderRadius: 8, fontSize: 14,
  fontWeight: 600, cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit",
};

// ─── Components ───

function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 2800); return () => clearTimeout(t); }, [onClose]);
  const bg = type === "success" ? colors.success : type === "error" ? colors.danger : colors.sub;
  return (
    <div style={{
      position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 1000,
      padding: "12px 28px", borderRadius: 10, color: "#fff", fontWeight: 600, fontSize: 13,
      background: bg, boxShadow: "0 6px 24px rgba(0,0,0,0.15)", whiteSpace: "nowrap",
    }}>
      {message}
    </div>
  );
}

function Calendar({ selectedDate, onSelect, reservations, settings, currentMonth, setCurrentMonth }) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const days = getMonthDays(year, month);

  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + settings.calendarMonths);
  const canGoNext = new Date(year, month + 1, 1) <= maxDate;
  const canGoPrev = new Date(year, month, 1) > new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={() => canGoPrev && setCurrentMonth(new Date(year, month - 1, 1))}
          disabled={!canGoPrev}
          style={{ ...baseBtn, padding: "6px 14px", background: canGoPrev ? colors.border : "#f0ebe4", color: canGoPrev ? colors.sub : colors.muted }}>
          ◀
        </button>
        <span style={{ fontSize: 17, fontWeight: 700, color: colors.text, letterSpacing: 1 }}>
          {year}年 {month + 1}月
        </span>
        <button onClick={() => canGoNext && setCurrentMonth(new Date(year, month + 1, 1))}
          disabled={!canGoNext}
          style={{ ...baseBtn, padding: "6px 14px", background: canGoNext ? colors.border : "#f0ebe4", color: canGoNext ? colors.sub : colors.muted }}>
          ▶
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {DAYS_JP.map((d, i) => (
          <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, padding: "4px 0",
            color: i === 0 ? colors.sunday : i === 6 ? colors.saturday : colors.sub }}>
            {d}
          </div>
        ))}
        {days.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />;
          const dateStr = fmtDate(new Date(year, month, day));
          const selected = selectedDate === dateStr;
          const past = isPast(dateStr);
          const today = isToday(dateStr);
          const dow = new Date(year, month, day).getDay();
          const holiday = settings.holidays.includes(dateStr);
          const disabled = past || holiday;

          let availDot = null;
          if (!disabled) {
            const ratio = getDateAvailability(dateStr, reservations, settings);
            const dotColor = ratio <= 0 ? colors.danger : ratio < 0.3 ? colors.warn : colors.success;
            availDot = (
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, marginTop: 2 }} />
            );
          }

          return (
            <button key={day} onClick={() => !disabled && onSelect(dateStr)} disabled={disabled}
              style={{
                aspectRatio: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                border: selected ? `2px solid ${colors.accent}` : today ? `2px solid ${colors.warn}` : "1px solid transparent",
                borderRadius: 8,
                background: selected ? colors.accentLight : holiday ? "#f0ebe4" : past ? "#f5f0ea" : colors.card,
                color: disabled ? colors.muted : dow === 0 ? colors.sunday : dow === 6 ? colors.saturday : colors.text,
                cursor: disabled ? "default" : "pointer", fontSize: 14, fontWeight: selected || today ? 700 : 500,
                transition: "all 0.12s", position: "relative",
              }}>
              {day}
              {holiday && <span style={{ fontSize: 7, color: colors.muted, lineHeight: 1 }}>休</span>}
              {!holiday && !past && availDot}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 10, fontSize: 11, color: colors.sub }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: colors.success, display: "inline-block" }} /> 空きあり
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: colors.warn, display: "inline-block" }} /> 残り少
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: colors.danger, display: "inline-block" }} /> 満員
        </span>
      </div>
    </div>
  );
}

function ProductPicker({ selected, onSelect }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: colors.sub }}>商品を選択</label>
      {PRODUCTS.map((p) => {
        const active = selected?.id === p.id;
        return (
          <button key={p.id} onClick={() => onSelect(p)}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "14px 16px", borderRadius: 10,
              border: active ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
              background: active ? colors.accentLight : colors.card,
              cursor: "pointer", transition: "all 0.15s", textAlign: "left",
            }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, color: colors.text }}>{p.name}</div>
              <div style={{ fontSize: 12, color: colors.sub, marginTop: 2 }}>
                所要時間 {p.durationMin}分 ／ 必要人数枠 {p.requiredSlots}人分
              </div>
            </div>
            {active && <span style={{ fontSize: 18, color: colors.accent }}>✓</span>}
          </button>
        );
      })}
    </div>
  );
}

function TimeSlotPicker({ date, product, reservations, settings, onSelect }) {
  if (!date || !product) {
    return <p style={{ color: colors.muted, textAlign: "center", padding: 16, fontSize: 13 }}>
      {!date ? "日付を選択してください" : "商品を選択してください"}
    </p>;
  }

  const allSlots = generateTimeSlots(settings);
  const closeMin = settings.closeHour * 60 + settings.closeMin;
  const validSlots = allSlots.filter((s) => {
    const startMin = s.hour * 60 + s.min;
    return startMin + product.durationMin <= closeMin;
  });

  const endTimeLabel = (slot) => {
    const endMin = slot.hour * 60 + slot.min + product.durationMin;
    return fmtTime(Math.floor(endMin / 60), endMin % 60);
  };

  return (
    <div>
      <label style={{ fontSize: 13, fontWeight: 600, color: colors.sub, marginBottom: 8, display: "block" }}>
        時間帯を選択（{date}　{product.name}）
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
        {validSlots.map((slot) => {
          const available = canBook(date, slot.label, product, reservations, settings);
          const occ = getSlotOccupancy(date, slot.label, reservations);
          const remaining = settings.maxCapacity - occ;

          return (
            <button key={slot.label} onClick={() => available && onSelect(slot.label)}
              disabled={!available}
              style={{
                padding: "12px 10px", borderRadius: 8,
                border: `1px solid ${available ? colors.border : "#eee"}`,
                background: available ? colors.card : "#f5f0ea",
                cursor: available ? "pointer" : "default",
                opacity: available ? 1 : 0.5, transition: "all 0.15s", textAlign: "center",
              }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: colors.text, fontVariantNumeric: "tabular-nums" }}>
                {slot.label}〜{endTimeLabel(slot)}
              </div>
              <div style={{
                fontSize: 11, fontWeight: 600, marginTop: 4,
                color: !available ? colors.muted : remaining <= 2 ? colors.danger : colors.success,
              }}>
                {available ? `残り${remaining}枠` : "予約不可"}
              </div>
            </button>
          );
        })}
      </div>
      {validSlots.length === 0 && (
        <p style={{ textAlign: "center", color: colors.muted, fontSize: 13, padding: 16 }}>
          この商品の所要時間に合う空き枠がありません
        </p>
      )}
    </div>
  );
}

function BookingForm({ date, startTime, product, settings, onConfirm, onCancel }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");

  const endMin = timeToMinutes(startTime) + product.durationMin;
  const endTime = fmtTime(Math.floor(endMin / 60), endMin % 60);

  const valid = name.trim() && phone.trim();

  return (
    <div style={{ background: colors.card, borderRadius: 12, padding: 20, border: `1px solid ${colors.border}` }}>
      <h3 style={{ margin: "0 0 6px", color: colors.text, fontSize: 17 }}>予約確認</h3>
      <div style={{ fontSize: 13, color: colors.sub, marginBottom: 18, lineHeight: 1.7 }}>
        <div>📅 {date}（{DAYS_JP[parseDate(date).getDay()]}）</div>
        <div>🕐 {startTime} 〜 {endTime}（{product.durationMin}分）</div>
        <div>📦 {product.name}（{product.requiredSlots}人分枠を使用）</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input placeholder="お名前 *" value={name} onChange={(e) => setName(e.target.value)}
          style={baseInput} />
        <input placeholder="電話番号 *" value={phone} onChange={(e) => setPhone(e.target.value)}
          type="tel" style={baseInput} />
        <textarea placeholder="備考（任意）" value={note} onChange={(e) => setNote(e.target.value)}
          rows={2} style={{ ...baseInput, resize: "vertical" }} />
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button onClick={onCancel}
            style={{ ...baseBtn, flex: 1, background: colors.border, color: colors.sub }}>
            戻る
          </button>
          <button disabled={!valid}
            onClick={() => valid && onConfirm({
              name: name.trim(), phone: phone.trim(), note: note.trim(),
              startTime, endTime, date,
              productId: product.id, productName: product.name,
              requiredSlots: product.requiredSlots, durationMin: product.durationMin,
            })}
            style={{
              ...baseBtn, flex: 2, color: "#fff",
              background: valid ? colors.accent : colors.border,
              cursor: valid ? "pointer" : "default",
            }}>
            予約を確定する
          </button>
        </div>
      </div>
    </div>
  );
}

function ReservationList({ reservations, onCancel }) {
  const active = reservations
    .filter((r) => r.status === "confirmed")
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  if (active.length === 0) {
    return <p style={{ textAlign: "center", color: colors.muted, padding: 30, fontSize: 14 }}>予約はありません</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {active.map((r) => {
        const past = isPast(r.date);
        return (
          <div key={r.id} style={{
            padding: "14px 16px", borderRadius: 10, border: `1px solid ${colors.border}`,
            background: past ? "#f5f0ea" : colors.card, opacity: past ? 0.65 : 1,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: colors.text }}>
                  {r.date}（{DAYS_JP[parseDate(r.date).getDay()]}）
                </div>
                <div style={{ fontSize: 13, color: colors.sub, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                  {r.startTime} 〜 {r.endTime}
                </div>
                <div style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
                  {r.productName}　／　{r.name}
                </div>
                {r.note && <div style={{ fontSize: 11, color: colors.muted, marginTop: 3 }}>備考: {r.note}</div>}
              </div>
              {!past && (
                <button onClick={() => onCancel(r.id)}
                  style={{ ...baseBtn, padding: "7px 14px", fontSize: 12, background: colors.dangerLight, color: colors.danger }}>
                  取消
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AdminPanel({ reservations, settings, onSettingsChange, onDeleteReservation }) {
  const [showSettings, setShowSettings] = useState(false);
  const [local, setLocal] = useState(settings);
  const [holidayInput, setHolidayInput] = useState("");

  const active = reservations
    .filter((r) => r.status === "confirmed")
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  const handleSave = () => { onSettingsChange(local); setShowSettings(false); };

  const addHoliday = () => {
    if (holidayInput && !local.holidays.includes(holidayInput)) {
      setLocal((s) => ({ ...s, holidays: [...s.holidays, holidayInput].sort() }));
      setHolidayInput("");
    }
  };

  const removeHoliday = (d) => setLocal((s) => ({ ...s, holidays: s.holidays.filter((h) => h !== d) }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 17, color: colors.text }}>管理パネル</h3>
        <button onClick={() => setShowSettings(!showSettings)}
          style={{ ...baseBtn, padding: "8px 16px", fontSize: 12, background: colors.border, color: colors.sub }}>
          {showSettings ? "閉じる" : "⚙ 設定"}
        </button>
      </div>

      {showSettings && (
        <div style={{ background: "#f9f5ef", borderRadius: 10, padding: 18, border: `1px solid ${colors.border}`, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: colors.sub, display: "block", marginBottom: 4 }}>同時利用上限人数</label>
            <input type="number" min={1} max={20} value={local.maxCapacity}
              onChange={(e) => setLocal((s) => ({ ...s, maxCapacity: parseInt(e.target.value) || 1 }))}
              style={{ ...baseInput, width: 80 }} />
          </div>

          <div>
            <label style={{ fontSize: 12, color: colors.sub, display: "block", marginBottom: 4 }}>営業時間</label>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="number" min={0} max={23} value={local.openHour}
                onChange={(e) => setLocal((s) => ({ ...s, openHour: parseInt(e.target.value) || 0 }))}
                style={{ ...baseInput, width: 55 }} />
              <span style={{ color: colors.sub }}>:</span>
              <input type="number" min={0} max={59} step={30} value={local.openMin}
                onChange={(e) => setLocal((s) => ({ ...s, openMin: parseInt(e.target.value) || 0 }))}
                style={{ ...baseInput, width: 55 }} />
              <span style={{ color: colors.sub, margin: "0 4px" }}>〜</span>
              <input type="number" min={0} max={23} value={local.closeHour}
                onChange={(e) => setLocal((s) => ({ ...s, closeHour: parseInt(e.target.value) || 0 }))}
                style={{ ...baseInput, width: 55 }} />
              <span style={{ color: colors.sub }}>:</span>
              <input type="number" min={0} max={59} step={30} value={local.closeMin}
                onChange={(e) => setLocal((s) => ({ ...s, closeMin: parseInt(e.target.value) || 0 }))}
                style={{ ...baseInput, width: 55 }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: colors.sub, display: "block", marginBottom: 4 }}>カレンダー表示月数</label>
            <input type="number" min={1} max={12} value={local.calendarMonths}
              onChange={(e) => setLocal((s) => ({ ...s, calendarMonths: parseInt(e.target.value) || 3 }))}
              style={{ ...baseInput, width: 55 }} />
          </div>

          <div>
            <label style={{ fontSize: 12, color: colors.sub, display: "block", marginBottom: 4 }}>休業日</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <input type="date" value={holidayInput} onChange={(e) => setHolidayInput(e.target.value)}
                style={{ ...baseInput, flex: 1 }} />
              <button onClick={addHoliday}
                style={{ ...baseBtn, padding: "8px 14px", fontSize: 12, background: colors.accent, color: "#fff" }}>
                追加
              </button>
            </div>
            {local.holidays.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {local.holidays.map((h) => (
                  <span key={h} style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "4px 10px", borderRadius: 6, background: colors.dangerLight,
                    fontSize: 12, color: colors.danger,
                  }}>
                    {h}
                    <button onClick={() => removeHoliday(h)}
                      style={{ background: "none", border: "none", color: colors.danger, cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <button onClick={handleSave}
            style={{ ...baseBtn, background: colors.success, color: "#fff", marginTop: 4 }}>
            設定を保存
          </button>
        </div>
      )}

      <div>
        <h4 style={{ margin: "0 0 10px", fontSize: 13, color: colors.sub }}>
          予約一覧（{active.length}件）
        </h4>
        {active.length === 0 ? (
          <p style={{ textAlign: "center", color: colors.muted, padding: 20, fontSize: 13 }}>予約はありません</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {active.map((r) => (
              <div key={r.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 14px", borderRadius: 8, border: `1px solid ${colors.border}`,
                background: isPast(r.date) ? "#f5f0ea" : colors.card, opacity: isPast(r.date) ? 0.5 : 1, fontSize: 13,
              }}>
                <div style={{ lineHeight: 1.6 }}>
                  <span style={{ fontWeight: 600, color: colors.text }}>{r.date}</span>
                  <span style={{ color: colors.sub, margin: "0 6px" }}>{r.startTime}〜{r.endTime}</span>
                  <br />
                  <span style={{ color: colors.muted, fontSize: 12 }}>{r.productName}　{r.name}　{r.phone}</span>
                </div>
                <button onClick={() => onDeleteReservation(r.id)}
                  style={{ ...baseBtn, padding: "5px 10px", fontSize: 11, background: colors.dangerLight, color: colors.danger, flexShrink: 0 }}>
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main App ───
export default function App() {
  const [reservations, setReservations] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const [tab, setTab] = useState("reserve");
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  useEffect(() => {
    (async () => {
      const [res, set] = await Promise.all([loadData(STORAGE_KEY, []), loadData(SETTINGS_KEY, DEFAULT_SETTINGS)]);
      setReservations(res);
      setSettings({ ...DEFAULT_SETTINGS, ...set });
      setLoading(false);
    })();
  }, []);

  const persist = useCallback(async (newRes) => {
    setReservations(newRes);
    await saveData(STORAGE_KEY, newRes);
  }, []);

  const persistSettings = useCallback(async (s) => {
    setSettings(s);
    await saveData(SETTINGS_KEY, s);
    setToast({ message: "設定を保存しました", type: "success" });
  }, []);

  const handleConfirm = async (info) => {
    const newR = {
      id: genId(), ...info,
      status: "confirmed", createdAt: new Date().toISOString(),
    };
    await persist([...reservations, newR]);
    setSelectedTime(null);
    setSelectedDate(null);
    setSelectedProduct(null);
    setToast({ message: "予約が確定しました", type: "success" });
    setTab("list");
  };

  const handleCancel = async (id) => {
    await persist(reservations.map((r) => r.id === id ? { ...r, status: "cancelled" } : r));
    setToast({ message: "予約をキャンセルしました", type: "error" });
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: colors.bg, color: colors.sub, fontFamily: "'Noto Sans JP', sans-serif" }}>
        読み込み中...
      </div>
    );
  }

  const tabBtn = (key, label) => ({
    flex: 1, padding: "11px 0", border: "none",
    borderBottom: tab === key ? `3px solid ${colors.accent}` : "3px solid transparent",
    background: "transparent", color: tab === key ? colors.accent : colors.sub,
    fontSize: 13, fontWeight: tab === key ? 700 : 500,
    cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit",
  });

  return (
    <div style={{ maxWidth: 460, margin: "0 auto", minHeight: "100vh", background: colors.bg, fontFamily: "'Noto Sans JP', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: ${colors.bg}; }
        input:focus, textarea:focus { border-color: ${colors.accent} !important; }
        button:hover:not(:disabled) { filter: brightness(0.96); }
      `}</style>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div style={{ padding: "24px 20px 0", textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: colors.text, letterSpacing: 2 }}>
          📦 倉庫ピック予約
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: colors.sub }}>大阪アパレル倉庫　予約管理</p>
      </div>

      <div style={{ display: "flex", borderBottom: `1px solid ${colors.border}`, margin: "16px 20px 0" }}>
        <button onClick={() => { setTab("reserve"); setSelectedTime(null); }} style={tabBtn("reserve")}>予約する</button>
        <button onClick={() => setTab("list")} style={tabBtn("list")}>予約一覧</button>
        <button onClick={() => setTab("admin")} style={tabBtn("admin")}>管理</button>
      </div>

      <div style={{ padding: 20 }}>
        {tab === "reserve" && (
          selectedTime ? (
            <BookingForm
              date={selectedDate}
              startTime={selectedTime}
              product={selectedProduct}
              settings={settings}
              onConfirm={handleConfirm}
              onCancel={() => setSelectedTime(null)}
            />
          ) : (
            <>
              <ProductPicker selected={selectedProduct} onSelect={(p) => { setSelectedProduct(p); setSelectedTime(null); }} />

              <Calendar
                selectedDate={selectedDate}
                onSelect={(d) => { setSelectedDate(d); setSelectedTime(null); }}
                reservations={reservations}
                settings={settings}
                currentMonth={currentMonth}
                setCurrentMonth={setCurrentMonth}
              />

              <TimeSlotPicker
                date={selectedDate}
                product={selectedProduct}
                reservations={reservations}
                settings={settings}
                onSelect={setSelectedTime}
              />
            </>
          )
        )}

        {tab === "list" && (
          <ReservationList reservations={reservations} onCancel={handleCancel} />
        )}

        {tab === "admin" && (
          <AdminPanel
            reservations={reservations}
            settings={settings}
            onSettingsChange={persistSettings}
            onDeleteReservation={handleCancel}
          />
        )}
      </div>
    </div>
  );
}
