// Fan-made, approximate ratings (0-100). Not official stats.
// P(name, minSlot, maxSlot, bat, pow, bwl, keeper?)
const P = (name, lo, hi, bat, pow, bwl, k = false) => ({ name, lo, hi, bat, pow, bwl, k })

export const SQUADS = [
  { id: 'wi79', name: 'West Indies', year: 1979, players: [
    P('Greenidge', 1, 2, 82, 78, 0), P('Haynes', 1, 2, 80, 66, 0), P('Richards', 3, 4, 92, 95, 30),
    P('Lloyd', 4, 5, 78, 76, 25), P('Kallicharran', 3, 5, 70, 66, 0), P('Murray', 6, 7, 55, 55, 0, true),
    P('King', 5, 7, 60, 82, 50), P('Roberts', 8, 9, 30, 55, 90), P('Holding', 9, 11, 20, 35, 92),
    P('Garner', 9, 11, 28, 40, 93), P('Croft', 10, 11, 15, 30, 88)] },
  { id: 'pak92', name: 'Pakistan', year: 1992, players: [
    P('Aamer Sohail', 1, 2, 66, 74, 25), P('Ramiz Raja', 1, 2, 72, 62, 0), P('Inzamam', 3, 4, 78, 80, 0),
    P('Javed Miandad', 3, 5, 80, 66, 10), P('Salim Malik', 4, 5, 70, 66, 15), P('Moin Khan', 6, 7, 55, 78, 0, true),
    P('Imran Khan', 5, 7, 75, 66, 85), P('Wasim Akram', 7, 8, 58, 80, 94), P('Mushtaq Ahmed', 8, 10, 25, 42, 82),
    P('Aaqib Javed', 9, 11, 15, 30, 80), P('Ijaz Ahmed', 4, 6, 60, 72, 0)] },
  { id: 'sl96', name: 'Sri Lanka', year: 1996, players: [
    P('Jayasuriya', 1, 2, 68, 96, 62), P('Kaluwitharana', 1, 2, 52, 92, 0, true), P('Mahanama', 3, 4, 72, 62, 0),
    P('de Silva', 3, 4, 82, 78, 55), P('Ranatunga', 4, 6, 76, 82, 20), P('Gurusinha', 3, 5, 74, 62, 30),
    P('Tillakaratne', 5, 7, 66, 55, 0), P('Dharmasena', 7, 8, 38, 50, 72), P('Vaas', 8, 10, 28, 55, 86),
    P('Muralitharan', 9, 11, 15, 40, 96), P('Wickramasinghe', 8, 10, 22, 42, 70)] },
  { id: 'aus03', name: 'Australia', year: 2003, players: [
    P('Gilchrist', 1, 2, 80, 94, 0, true), P('Hayden', 1, 2, 82, 80, 0), P('Ponting', 3, 3, 92, 85, 0),
    P('Martyn', 4, 5, 74, 68, 0), P('Lehmann', 4, 6, 72, 74, 10), P('Bevan', 5, 6, 90, 64, 5),
    P('Symonds', 5, 7, 76, 88, 55), P('Bichel', 7, 8, 42, 62, 78), P('Lee', 8, 9, 22, 52, 93),
    P('McGrath', 10, 11, 6, 20, 96), P('Gillespie', 9, 11, 14, 32, 90)] },
  { id: 'ind11', name: 'India', year: 2011, players: [
    P('Sehwag', 1, 2, 70, 97, 20), P('Tendulkar', 1, 2, 90, 86, 28), P('Gambhir', 2, 3, 80, 66, 0),
    P('Kohli', 3, 4, 90, 76, 12), P('Yuvraj', 4, 5, 70, 82, 62), P('Dhoni', 5, 6, 82, 88, 0, true),
    P('Raina', 5, 7, 66, 82, 40), P('Harbhajan', 7, 8, 32, 60, 78), P('Zaheer Khan', 8, 10, 22, 40, 90),
    P('Munaf Patel', 9, 11, 12, 32, 78), P('Ashwin', 7, 9, 36, 56, 82)] },
  { id: 'eng19', name: 'England', year: 2019, players: [
    P('Roy', 1, 2, 76, 94, 0), P('Bairstow', 1, 3, 78, 90, 0, true), P('Root', 3, 4, 92, 74, 30),
    P('Morgan', 4, 5, 80, 92, 0), P('Stokes', 5, 6, 74, 86, 70), P('Buttler', 5, 6, 80, 96, 0, true),
    P('Moeen Ali', 6, 7, 50, 84, 62), P('Woakes', 7, 8, 48, 66, 80), P('Plunkett', 8, 10, 28, 70, 80),
    P('Archer', 9, 10, 20, 52, 92), P('Wood', 10, 11, 10, 25, 88)] },
  { id: 'nz15', name: 'New Zealand', year: 2015, players: [
    P('McCullum', 1, 2, 60, 99, 0), P('Guptill', 1, 2, 76, 84, 0), P('Williamson', 3, 4, 86, 68, 20),
    P('Taylor', 3, 5, 82, 72, 5), P('Elliott', 4, 5, 76, 76, 40), P('Anderson', 5, 6, 56, 90, 50),
    P('Ronchi', 6, 7, 52, 86, 0, true), P('Vettori', 7, 8, 42, 58, 78), P('Southee', 8, 9, 24, 60, 86),
    P('Boult', 9, 11, 14, 30, 92), P('Henry', 9, 11, 16, 32, 86)] },
  { id: 'sa15', name: 'South Africa', year: 2015, players: [
    P('Amla', 1, 2, 90, 74, 0), P('de Kock', 1, 2, 76, 84, 0, true), P('du Plessis', 2, 3, 82, 70, 0),
    P('de Villiers', 3, 5, 94, 99, 5), P('Duminy', 4, 6, 76, 72, 55), P('Miller', 5, 6, 68, 92, 0),
    P('Rossouw', 3, 5, 64, 82, 0), P('Steyn', 8, 10, 14, 40, 97), P('Morkel', 9, 11, 18, 38, 90),
    P('Tahir', 10, 11, 10, 25, 88), P('Philander', 7, 9, 38, 48, 84)] },
]

export const SLOT_LABELS = ['Opener', 'Opener', 'No. 3', 'No. 4', 'No. 5', 'No. 6', 'No. 7', 'No. 8', 'No. 9', 'No. 10', 'No. 11']
export const TARGET = 500
export const BALLS = 300
