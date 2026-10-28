/**
 * Where to pick up a rental car at an airport, from the airport's own pages (read 2026-10-28). Airports not listed are
 * looked up with search_travel_info, and what it cannot confirm is said.
 */
export interface RentalCars {
  where: string;
  how: string;
  companies?: string[];
  offsite?: string;
  url: string;
  checkedOn: string;
}

export const RENTAL_CARS: Record<string, RentalCars> = {
  ORD: {
    where: "Multi-Modal Facility (MMF), 10255 W. Zemke Blvd.",
    how: "Airport Transit System (ATS) train from Terminals 1, 2, 3 or 5; it runs 24 hours, every 3-5 minutes at peak",
    companies: ["Alamo", "Avis", "Budget", "Dollar", "Enterprise", "Fox", "Hertz", "National", "Payless", "Sixt", "Thrifty"],
    offsite: "ACE Rent A Car and Routes Car Rental pick up at MMF bus bay 1",
    url: "https://www.flychicago.com/ohare/tofrom/rentalcar/pages/default.aspx",
    checkedOn: "2026-10-28",
  },
  YUL: {
    where: "the counters are in the P4 parking lot, open daily 7 a.m. to 1 a.m.",
    how: "from door 28 on the arrivals level, go to the Leigh-Capreol drop-off area and take the free shuttle to P4",
    offsite: "off-site companies (such as Routes and Europcar): free shuttle from door 8 on the departures level, after calling the company",
    url: "https://yulsatisfaction.admtl.com/hc/en-ca/articles/360000839397",
    checkedOn: "2026-10-28",
  },
};
