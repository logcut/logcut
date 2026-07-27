import type { JSX } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { LanguageOption } from '@logcut/core'

const LABELS: Record<LanguageOption, string> = {
  auto: 'Auto',
  english: 'English',
  simplified: '简体中文',
  traditional: '繁體中文'
}

interface LanguageSelectProps {
  options: LanguageOption[]
  value: LanguageOption
  onChange(option: LanguageOption): void
}

export default function LanguageSelect({
  options,
  value,
  onChange
}: LanguageSelectProps): JSX.Element {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as LanguageOption)}>
      {/* Full width, not a fixed one: shadcn's trigger defaults to w-fit, and
          the caller decides how wide a settings row is. */}
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
