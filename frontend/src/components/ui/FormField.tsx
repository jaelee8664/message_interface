interface FormFieldProps {
  label: string
  hint?: string
  children: React.ReactNode
}

export function FormField({ label, hint, children }: FormFieldProps) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-300">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
}

export function InputField({ label, hint, ...props }: InputProps) {
  return (
    <FormField label={label} hint={hint}>
      <input
        {...props}
        className={`w-full px-3 py-1.5 text-sm rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 ${props.className ?? ''}`}
      />
    </FormField>
  )
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  hint?: string
  options: { value: string; label: string }[]
}

export function SelectField({ label, hint, options, ...props }: SelectProps) {
  return (
    <FormField label={label} hint={hint}>
      <select
        {...props}
        className={`w-full px-3 py-1.5 text-sm rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500 ${props.className ?? ''}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </FormField>
  )
}

interface CheckboxProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string
}

export function CheckboxField({ label, checked, onChange, hint }: CheckboxProps) {
  return (
    <FormField label="" hint={hint}>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 accent-blue-500"
        />
        <span className="text-sm text-slate-300">{label}</span>
      </label>
    </FormField>
  )
}
