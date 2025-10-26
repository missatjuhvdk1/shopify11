// Highest shipping prices per destination country from Steamstory.pdf (EUR)
// Keys use ISO 3166-1 alpha-2 country codes.
export const SHIPPING_COSTS_EUR = {
  NL: 6.78, // Nederland: max(brievenbus 5.78, pakket 6.78)
  BE: 7.3, // België: max(6.74, 7.30)
  DE: 7.75, // Duitsland: max(6.45, 7.75)
  US: 16.45, // USA
  CH: 9.45, // Zwitserland: max(8.62, 9.45)
  AU: 18.45, // Australië
  IL: 12.21, // Israel
  ES: 8.78, // Spanje
  FR: 7.85, // Frankrijk
  SE: 7.79, // Zweden
  GB: 8.53, // UK
  LT: 8.56, // Litouwen
  PK: 18.84, // Pakistan: max(18.84, 17.60)
  MT: 12.57, // Malta
  AT: 9.35, // Oostenrijk
  IE: 8.81, // Ierland
  CA: 21.11, // Canada
  CY: 13.45, // Cyprus
  PL: 8.92, // Polen
};

export const getShippingCostForCountry = (countryCode) => {
  if (!countryCode) return 0;
  return Number(SHIPPING_COSTS_EUR[countryCode]) || 0;
};

