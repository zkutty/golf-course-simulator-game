import { useEffect, useState } from "react";
import type { MessageKey } from "../i18n/catalog";
import { useI18n } from "../i18n/useI18n";
import { AdvisorPortrait } from "./onboarding/AdvisorPresenter";
import "./VisionPage.css";

type Feature = {
  icon: string;
  title: MessageKey;
  body: MessageKey;
  detail: MessageKey;
};

type FutureFeature = {
  milestone: MessageKey;
  title: MessageKey;
  body: MessageKey;
  detail: MessageKey;
};

const FEATURES: Feature[] = [
  { icon: "⌁", title: "vision.feature.design.title", body: "vision.feature.design.body", detail: "vision.feature.design.detail" },
  { icon: "◉", title: "vision.feature.golfers.title", body: "vision.feature.golfers.body", detail: "vision.feature.golfers.detail" },
  { icon: "⌂", title: "vision.feature.campus.title", body: "vision.feature.campus.body", detail: "vision.feature.campus.detail" },
  { icon: "↗", title: "vision.feature.business.title", body: "vision.feature.business.body", detail: "vision.feature.business.detail" },
  { icon: "♜", title: "vision.feature.events.title", body: "vision.feature.events.body", detail: "vision.feature.events.detail" },
  { icon: "✦", title: "vision.feature.legacy.title", body: "vision.feature.legacy.body", detail: "vision.feature.legacy.detail" },
];

const FUTURE_FEATURES: FutureFeature[] = [
  { milestone: "vision.future.play.milestone", title: "vision.future.play.title", body: "vision.future.play.body", detail: "vision.future.play.detail" },
  { milestone: "vision.future.feedback.milestone", title: "vision.future.feedback.title", body: "vision.future.feedback.body", detail: "vision.future.feedback.detail" },
  { milestone: "vision.future.people.milestone", title: "vision.future.people.title", body: "vision.future.people.body", detail: "vision.future.people.detail" },
  { milestone: "vision.future.seasons.milestone", title: "vision.future.seasons.title", body: "vision.future.seasons.body", detail: "vision.future.seasons.detail" },
  { milestone: "vision.future.campaign.milestone", title: "vision.future.campaign.title", body: "vision.future.campaign.body", detail: "vision.future.campaign.detail" },
  { milestone: "vision.future.premium.milestone", title: "vision.future.premium.title", body: "vision.future.premium.body", detail: "vision.future.premium.detail" },
];

const CHAPTERS = [
  { number: "01", title: "vision.chapter.land.title", body: "vision.chapter.land.body" },
  { number: "02", title: "vision.chapter.course.title", body: "vision.chapter.course.body" },
  { number: "03", title: "vision.chapter.club.title", body: "vision.chapter.club.body" },
  { number: "04", title: "vision.chapter.legacy.title", body: "vision.chapter.legacy.body" },
] satisfies Array<{ number: string; title: MessageKey; body: MessageKey }>;

const WORLD_IMAGE = `${import.meta.env.BASE_URL}vision/coursecraft-world.jpg`;
const CLUBHOUSE_IMAGE = `${import.meta.env.BASE_URL}vision/clubhouse-campus.jpg`;
const COAST_IMAGE = `${import.meta.env.BASE_URL}vision/coastal-routing.jpg`;

export function VisionPage({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [shared, setShared] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${t("vision.nav.vision")} — ${t("app.name")}`;
    return () => {
      document.title = previousTitle;
    };
  }, [t]);

  async function shareVision() {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "vision");
    const shareData = { title: t("vision.share.title"), text: t("vision.share.text"), url: url.toString() };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareData.url);
        setShared(true);
        window.setTimeout(() => setShared(false), 1800);
      }
    } catch {
      // Closing the native share sheet is not an error the page needs to surface.
    }
  }

  return (
    <main className="cc-vision" data-testid="vision-page">
      <nav className="cc-vision-nav" aria-label={t("vision.nav.aria")}>
        <button className="cc-vision-brand" onClick={onClose}>
          <span className="cc-vision-brand-mark" aria-hidden="true">⛳</span>
          <span>{t("app.name")}</span>
          <small>{t("vision.nav.vision")}</small>
        </button>
        <div className="cc-vision-nav-links">
          <a href="#vision-story">{t("vision.nav.story")}</a>
          <a href="#vision-systems">{t("vision.nav.systems")}</a>
          <a href="#vision-play">{t("vision.nav.play")}</a>
          <a href="#vision-world">{t("vision.nav.world")}</a>
        </div>
        <div className="cc-vision-nav-actions">
          <button className="cc-vision-button cc-vision-button-ghost" onClick={onClose}>{t("vision.back")}</button>
          <button className="cc-vision-button cc-vision-button-gold" onClick={() => void shareVision()}>
            {shared ? t("vision.copied") : t("vision.share")}
          </button>
        </div>
      </nav>

      <header className="cc-vision-hero">
        <img src={WORLD_IMAGE} alt={t("vision.hero.imageAlt")} />
        <div className="cc-vision-hero-shade" />
        <div className="cc-vision-hero-copy">
          <p className="cc-vision-kicker">{t("vision.hero.kicker")}</p>
          <h1>{t("vision.hero.title")}</h1>
          <p className="cc-vision-hero-deck">{t("vision.hero.deck")}</p>
          <div className="cc-vision-hero-actions">
            <a className="cc-vision-button cc-vision-button-gold" href="#vision-story">{t("vision.hero.cta")}</a>
            <button className="cc-vision-button cc-vision-button-glass" onClick={() => void shareVision()}>{t("vision.share")}</button>
          </div>
        </div>
        <div className="cc-vision-hero-caption">
          <span>{t("vision.hero.captionLabel")}</span>
          <strong>{t("vision.hero.caption")}</strong>
        </div>
      </header>

      <section className="cc-vision-manifesto" id="vision-story">
        <div className="cc-vision-section-label">{t("vision.story.eyebrow")}</div>
        <div>
          <h2>{t("vision.story.title")}</h2>
          <p>{t("vision.story.body")}</p>
        </div>
        <div className="cc-vision-principles">
          <article><strong>{t("vision.principle.create.title")}</strong><span>{t("vision.principle.create.body")}</span></article>
          <article><strong>{t("vision.principle.operate.title")}</strong><span>{t("vision.principle.operate.body")}</span></article>
          <article><strong>{t("vision.principle.remember.title")}</strong><span>{t("vision.principle.remember.body")}</span></article>
        </div>
      </section>

      <section className="cc-vision-storyboard">
        <div className="cc-vision-storyboard-grid">
          <div className="cc-vision-story-image cc-vision-story-image-course">
            <img src={COAST_IMAGE} alt={t("vision.course.imageAlt")} loading="lazy" />
            <span>{t("vision.course.imageCaption")}</span>
          </div>
          <div className="cc-vision-story-copy">
            <p className="cc-vision-kicker">{t("vision.course.kicker")}</p>
            <h2>{t("vision.course.title")}</h2>
            <p>{t("vision.course.body")}</p>
            <div className="cc-vision-beats">
              <span>{t("vision.course.beat1")}</span>
              <span>{t("vision.course.beat2")}</span>
              <span>{t("vision.course.beat3")}</span>
              <span>{t("vision.course.beat4")}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="cc-vision-future" id="vision-play">
        <div className="cc-vision-future-intro">
          <div>
            <p className="cc-vision-kicker">{t("vision.future.kicker")}</p>
            <h2>{t("vision.future.title")}</h2>
          </div>
          <div>
            <p>{t("vision.future.body")}</p>
            <div className="cc-vision-future-loop" aria-label={t("vision.future.loopAria")}>
              <span>{t("vision.future.loop.build")}</span>
              <i aria-hidden="true">→</i>
              <span>{t("vision.future.loop.play")}</span>
              <i aria-hidden="true">→</i>
              <span>{t("vision.future.loop.learn")}</span>
              <i aria-hidden="true">→</i>
              <span>{t("vision.future.loop.redesign")}</span>
            </div>
          </div>
        </div>
        <div className="cc-vision-future-grid">
          {FUTURE_FEATURES.map((feature, index) => (
            <article key={feature.title} className="cc-vision-future-card">
              <div className="cc-vision-future-card-topline">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <small>{t(feature.milestone)}</small>
              </div>
              <h3>{t(feature.title)}</h3>
              <p>{t(feature.body)}</p>
              <strong>{t(feature.detail)}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="cc-vision-caddie">
        <div className="cc-vision-caddie-portrait"><AdvisorPortrait expression="excited" size={190} /></div>
        <div className="cc-vision-caddie-card">
          <p className="cc-vision-kicker">{t("vision.caddie.kicker")}</p>
          <blockquote>{t("vision.caddie.quote")}</blockquote>
          <p>{t("vision.caddie.body")}</p>
          <div className="cc-vision-caddie-tags">
            <span>{t("vision.caddie.tag1")}</span>
            <span>{t("vision.caddie.tag2")}</span>
            <span>{t("vision.caddie.tag3")}</span>
          </div>
        </div>
      </section>

      <section className="cc-vision-systems" id="vision-systems">
        <div className="cc-vision-section-heading">
          <p className="cc-vision-kicker">{t("vision.systems.kicker")}</p>
          <h2>{t("vision.systems.title")}</h2>
          <p>{t("vision.systems.body")}</p>
        </div>
        <div className="cc-vision-feature-grid">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="cc-vision-feature">
              <span className="cc-vision-feature-icon" aria-hidden="true">{feature.icon}</span>
              <h3>{t(feature.title)}</h3>
              <p>{t(feature.body)}</p>
              <small>{t(feature.detail)}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="cc-vision-world" id="vision-world">
        <img src={CLUBHOUSE_IMAGE} alt={t("vision.clubhouse.imageAlt")} loading="lazy" />
        <div className="cc-vision-world-overlay">
          <p className="cc-vision-kicker">{t("vision.clubhouse.kicker")}</p>
          <h2>{t("vision.clubhouse.title")}</h2>
          <p>{t("vision.clubhouse.body")}</p>
          <div className="cc-vision-world-ledger">
            <span><strong>{t("vision.clubhouse.metric1.value")}</strong>{t("vision.clubhouse.metric1.label")}</span>
            <span><strong>{t("vision.clubhouse.metric2.value")}</strong>{t("vision.clubhouse.metric2.label")}</span>
            <span><strong>{t("vision.clubhouse.metric3.value")}</strong>{t("vision.clubhouse.metric3.label")}</span>
          </div>
        </div>
      </section>

      <section className="cc-vision-arc">
        <div className="cc-vision-section-heading">
          <p className="cc-vision-kicker">{t("vision.arc.kicker")}</p>
          <h2>{t("vision.arc.title")}</h2>
        </div>
        <div className="cc-vision-arc-line">
          {CHAPTERS.map((chapter) => (
            <article key={chapter.number}>
              <span>{chapter.number}</span>
              <h3>{t(chapter.title)}</h3>
              <p>{t(chapter.body)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="cc-vision-finale">
        <div>
          <p className="cc-vision-kicker">{t("vision.finale.kicker")}</p>
          <h2>{t("vision.finale.title")}</h2>
          <p>{t("vision.finale.body")}</p>
        </div>
        <div className="cc-vision-finale-actions">
          <button className="cc-vision-button cc-vision-button-gold" onClick={onClose}>{t("vision.finale.cta")}</button>
          <button className="cc-vision-button cc-vision-button-ghost-light" onClick={() => void shareVision()}>{t("vision.share")}</button>
        </div>
      </section>

      <footer className="cc-vision-footer">
        <span>{t("app.name")} · {t("vision.footer")}</span>
        <button onClick={onClose}>{t("vision.back")}</button>
      </footer>
    </main>
  );
}
