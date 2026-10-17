import { useEffect, useRef, useState } from "react";
import { staffApi } from "../../api/staff";

// Type-ahead picker over the staff on the system. Typing a name (e.g.
// "Emilie") lists matching staff, like picking a recipient in an email
// "To" field. Selecting one stores the user's id; editing the text clears it.
export default function StaffPicker({ value, valueName, onChange, placeholder = "Type a staff name...", invalid }) {
  const [text, setText] = useState(valueName || "");
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setLoading(true);
    const timer = setTimeout(() => {
      staffApi
        .directory({ search: text })
        .then(({ data }) => setOptions(data))
        .catch(() => setOptions([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [text, open]);

  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(user) {
    setText(user.name);
    setOpen(false);
    onChange(user.id, user.name);
  }

  return (
    <div className="relative" ref={boxRef}>
      <input
        className={"form-input" + (invalid ? " border-warning" : "")}
        placeholder={placeholder}
        value={text}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (value) onChange("", "");
        }}
      />
      {open && (
        <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-line bg-white shadow-lg">
          {loading && options.length === 0 && <li className="px-3 py-2 text-sm text-ink-faint">Searching...</li>}
          {!loading && options.length === 0 && <li className="px-3 py-2 text-sm text-ink-faint">No staff found.</li>}
          {options.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#F1F4F9]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(u)}
              >
                <span className="text-ink">{u.name}</span>
                <span className="ml-2 text-ink-faint">{u.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
