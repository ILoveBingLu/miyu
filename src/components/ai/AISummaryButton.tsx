import React from 'react'
import { Sparkles } from 'lucide-react'
import './AISummaryButton.scss'

interface AISummaryButtonProps {
  sessionId: string
  onClick: () => void
}

export const AISummaryButton: React.FC<AISummaryButtonProps> = ({ onClick }) => {
  return (
    <button className="ai-summary-button" onClick={onClick} title="AI 摘要">
      <Sparkles size={18} />
      <span>AI摘要</span>
    </button>
  )
}
