// Fan-made T20 squads, approximate ratings (0-100). Not official stats.
// P(name, minSlot, maxSlot, bat, pow, bwl, keeper?)
const P = (name, lo, hi, bat, pow, bwl, k = false) => ({ name, lo, hi, bat, pow, bwl, k })

export const SQUADS = [
  { id: 'ind07', name: 'India', year: 2007, players: [
    P('Gambhir', 1, 2, 72, 76, 0), P('Sehwag', 1, 2, 66, 92, 10), P('Yuvraj', 3, 5, 78, 96, 40),
    P('Uthappa', 3, 5, 60, 80, 0), P('Rohit', 4, 6, 62, 78, 10), P('Dhoni', 5, 6, 80, 88, 0, true),
    P('I. Pathan', 6, 8, 50, 70, 85), P('Harbhajan', 7, 9, 30, 55, 80), P('RP Singh', 9, 10, 10, 30, 82),
    P('Sreesanth', 10, 11, 10, 25, 76), P('J. Sharma', 9, 11, 10, 30, 70)] },
  { id: 'ind24', name: 'India', year: 2024, players: [
    P('Rohit', 1, 2, 80, 94, 0), P('Kohli', 1, 3, 90, 84, 0), P('Pant', 3, 5, 70, 88, 0, true),
    P('SKY', 3, 4, 82, 98, 0), P('Dube', 4, 6, 60, 90, 30), P('Hardik', 5, 6, 66, 90, 82),
    P('Jadeja', 6, 7, 50, 72, 85), P('Axar', 7, 8, 40, 76, 84), P('Kuldeep', 8, 10, 10, 30, 88),
    P('Bumrah', 10, 11, 8, 20, 98), P('Arshdeep', 10, 11, 8, 25, 90)] },
  { id: 'wi16', name: 'West Indies', year: 2016, players: [
    P('Gayle', 1, 2, 80, 98, 20), P('Charles', 1, 3, 60, 84, 0), P('Simmons', 2, 3, 66, 78, 0),
    P('Samuels', 3, 4, 70, 70, 30), P('Bravo', 4, 6, 66, 84, 80), P('Russell', 5, 6, 60, 99, 86),
    P('Sammy', 6, 7, 38, 86, 55), P('Ramdin', 6, 7, 40, 72, 0, true), P('Brathwaite', 7, 8, 36, 92, 75),
    P('Narine', 8, 9, 28, 70, 95), P('Badree', 10, 11, 8, 20, 88)] },
  { id: 'aus21', name: 'Australia', year: 2021, players: [
    P('Warner', 1, 2, 88, 88, 0), P('Finch', 1, 2, 78, 90, 0), P('Marsh', 3, 3, 82, 86, 40),
    P('Smith', 3, 4, 74, 74, 10), P('Maxwell', 4, 5, 72, 96, 60), P('Stoinis', 5, 6, 60, 90, 62),
    P('Wade', 6, 7, 62, 90, 0, true), P('Cummins', 8, 9, 30, 60, 88), P('Starc', 9, 10, 10, 40, 90),
    P('Zampa', 10, 11, 8, 20, 94), P('Hazlewood', 10, 11, 8, 20, 92)] },
  { id: 'eng22', name: 'England', year: 2022, players: [
    P('Hales', 1, 2, 74, 92, 0), P('Buttler', 1, 3, 82, 96, 0, true), P('Malan', 2, 3, 86, 82, 0),
    P('Brook', 3, 4, 70, 88, 0), P('Livingstone', 4, 5, 62, 96, 50), P('Stokes', 4, 6, 60, 80, 70),
    P('Moeen', 5, 7, 50, 86, 70), P('S. Curran', 7, 8, 36, 80, 90), P('Woakes', 8, 9, 24, 50, 82),
    P('Rashid', 9, 10, 14, 48, 92), P('Jordan', 9, 11, 12, 40, 86)] },
  { id: 'pak12', name: 'Pakistan', year: 2012, players: [
    P('Hafeez', 1, 2, 66, 74, 60), P('N. Jamshed', 1, 2, 56, 78, 0), P('K. Akmal', 1, 3, 56, 86, 0, true),
    P('Misbah', 3, 5, 68, 74, 0), P('U. Akmal', 4, 6, 52, 84, 0), P('Malik', 5, 6, 58, 74, 60),
    P('Afridi', 5, 7, 36, 98, 85), P('Razzaq', 7, 8, 34, 86, 70), P('Gul', 9, 10, 10, 38, 92),
    P('Ajmal', 10, 11, 6, 20, 96), P('Junaid', 10, 11, 6, 20, 80)] },
  { id: 'sl14', name: 'Sri Lanka', year: 2014, players: [
    P('Dilshan', 1, 2, 72, 90, 20), P('Perera', 1, 2, 56, 92, 0), P('Sangakkara', 3, 3, 88, 84, 0, true),
    P('Jayawardene', 3, 4, 80, 78, 0), P('Chandimal', 4, 5, 60, 76, 0), P('Mathews', 5, 6, 62, 82, 72),
    P('Kapugedera', 5, 6, 46, 84, 0), P('T. Perera', 7, 8, 36, 90, 72), P('Kulasekara', 8, 9, 22, 50, 82),
    P('Malinga', 9, 11, 10, 40, 96), P('Mendis', 10, 11, 8, 20, 92)] },
  { id: 'sa14', name: 'South Africa', year: 2014, players: [
    P('de Kock', 1, 2, 68, 88, 0, true), P('Amla', 1, 3, 76, 78, 0), P('du Plessis', 2, 3, 72, 82, 0),
    P('de Villiers', 3, 5, 84, 100, 5), P('Duminy', 4, 5, 70, 82, 50), P('Miller', 5, 6, 60, 94, 0),
    P('Parnell', 6, 8, 30, 70, 76), P('Abbott', 8, 9, 10, 40, 86), P('Morkel', 8, 9, 20, 50, 84),
    P('Steyn', 9, 10, 10, 30, 95), P('Tahir', 10, 11, 6, 20, 94)] },
  { id: 'nz21', name: 'New Zealand', year: 2021, players: [
    P('Guptill', 1, 2, 62, 92, 0), P('Conway', 1, 3, 88, 84, 0, true), P('Williamson', 3, 4, 80, 76, 10),
    P('Mitchell', 3, 5, 66, 86, 30), P('Phillips', 4, 5, 58, 92, 20), P('Neesham', 5, 6, 46, 95, 66),
    P('Santner', 7, 8, 30, 70, 88), P('Southee', 8, 9, 14, 50, 88), P('Boult', 9, 11, 8, 26, 94),
    P('Sodhi', 10, 11, 6, 20, 82), P('Ferguson', 9, 11, 8, 28, 90)] },
]

export const SLOT_LABELS = ['Opener', 'Opener', 'No. 3', 'No. 4', 'No. 5', 'No. 6', 'No. 7', 'No. 8', 'No. 9', 'No. 10', 'No. 11']
export const TARGET = 300
export const BALLS = 120 // 20 overs
