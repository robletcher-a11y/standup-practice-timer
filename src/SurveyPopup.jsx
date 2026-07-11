import { useState } from 'react'

const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xykqrqdv'

const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)

function ShareButtons({ shareUrl }) {
  const [copied, setCopied] = useState(false)

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const openShare = (url) => window.open(url, '_blank', 'noopener,noreferrer')

  const shareText = 'Check out this stand-up comedy practice timer:'

  return (
    <div className="share-buttons">
      <button onClick={copyLink} className="share-button">
        {copied ? 'Copied!' : 'Copy Link'}
      </button>
      <button
        onClick={() =>
          openShare(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`)
        }
        className="share-button"
      >
        Facebook
      </button>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(shareUrl)
          openShare('https://www.instagram.com/')
        }}
        className="share-button"
      >
        Instagram
      </button>
      <button
        onClick={() =>
          openShare(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`)
        }
        className="share-button"
      >
        LinkedIn
      </button>
      {isMobile && (
        <a
          className="share-button"
          href={`sms:?&body=${encodeURIComponent(`${shareText} ${shareUrl}`)}`}
        >
          Text Message
        </a>
      )}
    </div>
  )
}

export default function SurveyPopup({ onDismiss, onSubmitted }) {
  const [view, setView] = useState('form') // 'form' | 'thanks'
  const [email, setEmail] = useState('')
  const [rating, setRating] = useState(null)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const shareUrl = window.location.origin + window.location.pathname

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || rating === null) {
      setError('Please add your email and a rating before submitting.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, rating, feedback, page: shareUrl }),
      })
      if (!res.ok) throw new Error('Submission failed')
      onSubmitted()
      setView('thanks')
    } catch {
      setError('Something went wrong sending your feedback. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="survey-overlay" onClick={onDismiss}>
      <div className="survey-card" onClick={(e) => e.stopPropagation()}>
        <button className="survey-close" onClick={onDismiss} aria-label="Close">
          ×
        </button>

        {view === 'form' ? (
          <form onSubmit={handleSubmit} className="survey-form">
            <h2>Help us improve this tool</h2>
            <p className="survey-subtitle">
              We're building more features for comedians. Two minutes of your time helps a lot.
            </p>

            <label className="survey-field">
              <span>Email address</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. jane@example.com"
                required
              />
              <span className="survey-hint">We'll only use this to share new features as we build them.</span>
            </label>

            <div className="survey-field">
              <span>How likely are you to recommend this tool to other comedians? (1&ndash;10)</span>
              <div className="rating-scale">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    type="button"
                    key={n}
                    className={`rating-button ${rating === n ? 'selected' : ''}`}
                    onClick={() => setRating(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="survey-hint">1 = not likely at all, 10 = extremely likely</span>
            </div>

            <label className="survey-field">
              <span>What did you like or not like?</span>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="e.g. Love the flash warning at 1 minute left. Would be great to save past recordings..."
                rows={4}
              />
              <span className="survey-hint">Any features or ideas you'd want to see are welcome too.</span>
            </label>

            {error && <div className="survey-error">{error}</div>}

            <button type="submit" className="survey-submit" disabled={submitting}>
              {submitting ? 'Sending...' : 'Submit'}
            </button>
          </form>
        ) : (
          <div className="survey-thanks">
            <h2>Thank you!</h2>
            <p className="survey-subtitle">
              Your feedback helps us build a better tool. Know another comedian who could use this?
            </p>
            <ShareButtons shareUrl={shareUrl} />
          </div>
        )}
      </div>
    </div>
  )
}
