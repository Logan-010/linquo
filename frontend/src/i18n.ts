import i18n from 'i18next';
import { useEffect, useState } from 'preact/hooks';

import en from './locales/en.json';

i18n.init({
  resources: {
    en: { translation: en }
  },
  lng: "en",
  fallbackLng: "en",
  supportedLngs: ["en"]
});

export function useTranslation() {
  const [_, setLanguageVersion] = useState(0);

  useEffect(() => {
    const update = () => setLanguageVersion(v => v + 1);

    i18n.on("languageChanged", update);
    return () => i18n.off("languageChanged", update);
  }, []);

  return {
    t: i18n.t.bind(i18n),
    language: i18n.language,
    changeLanguage: (lng: string) => i18n.changeLanguage(lng)
  }
}
