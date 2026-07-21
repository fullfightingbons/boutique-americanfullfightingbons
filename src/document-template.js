/**
 * document-template.js — AFFBC
 * ─────────────────────────────────────────────────────────────────────────
 * Gabarit PDF UNIQUE pour tous les documents remis aux membres/clients :
 *   - facture boutique (commande)
 *   - facture de vente manuelle (back-office gestion)
 *   - reçu de don (back-office gestion)
 *   - reçu de cotisation (espace membre)
 *   - attestation de cotisation (espace membre)
 *
 * Charte : noir (#111111) + doré (#D4AC0D), identique sur tous les projets.
 * S'appuie sur pdf-engine.js (à copier à côté de ce fichier dans chaque repo).
 *
 * ⚠️ Mentions légales : le champ `mentionTva` est centralisé ici pour éviter
 * que chaque projet écrive sa propre formulation (aujourd'hui divergente
 * entre boutique et gestion — à faire trancher par le comptable du club
 * avant mise en prod, cf. constante MENTION_TVA_DEFAUT ci-dessous).
 */

import { PdfBuilder, buildPdfDocument, addJpegImage, base64ToBytes, measureTextWidth, MM } from './pdf-engine.js';
import { CLUB_LOGO_JPEG_B64, CLUB_LOGO_WIDTH_PX, CLUB_LOGO_HEIGHT_PX } from './club-logo.js';

// ─── Charte graphique commune ─────────────────────────────────────────────
export const NOIR      = [17, 17, 17];       // #111111 — bandeaux, texte fort
export const INK        = [34, 34, 34];      // #222222 — texte courant
export const DORE       = [180, 141, 24];    // #B48D18 — doré texte (lisible sur blanc)
export const DORE_CLAIR = [212, 172, 13];    // #D4AC0D — doré plein (fonds/bandeaux)
export const DORE_BG    = [250, 243, 220];   // fond doré très clair (bloc déductibilité)
export const MUTED      = [128, 128, 128];   // #808080 — labels, sous-titres
export const LINE       = [224, 224, 224];   // #E0E0E0 — filets
export const ROW_ALT    = [250, 250, 248];   // fond ligne alternée
export const WHITE      = [255, 255, 255];

// ⚠️ À confirmer avec le comptable / trésorier avant harmonisation définitive
// (boutique utilisait "art. 293 B du CGI", gestion "art. 261-7-1°b du CGI").
export const MENTION_TVA_DEFAUT =
  "TVA non applicable — association loi 1901 non assujettie (art. 293 B du CGI)";

// Coordonnées officielles du club — vérifiées dans les mentions légales
// (site, boutique, calendrier, inscription — cohérentes sur les 4 repos),
// à l'exception du téléphone : les pages mentions-légales affichent partout
// "06 83 49 21 37", mais le numéro à retenir (confirmé) est "06 99 95 81 77"
// — cf. inscription/_lib/pdf.js et inscription-config.js, à corriger dans
// les mentions légales des autres repos pour rester cohérent.
const RNA = 'W744007210';
const SIREN = '924 704 612';
const SIRET = '924 704 612 00010';
const CLUB_NOM = 'American Full Fighting Bons en Chablais';
const CLUB_SIGLE = 'AFFBC';
const CLUB_ADRESSE_L1 = 'DOJO du Gymnase Intercommunal des Voirons';
const CLUB_ADRESSE_L2 = '146 Rue du Chatelard, 74890 Bons-en-Chablais';
const CLUB_EMAIL = 'fullfightingbons@gmail.com';
const CLUB_TEL = '06 99 95 81 77';
const CLUB_SITE = 'americanfullfightingbons.fr';

function eur(n) {
  const v = Number(n || 0);
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// ─── En-tête et pied de page communs à tous les documents ────────────────
const HEADER_H = 41;

// Largeur de titre variable : les 4 intitulés vont de "Facture" (7) à
// "Attestation de cotisation" (25) — on réduit la police pour les plus longs
// afin qu'ils ne chevauchent jamais le bloc identité club à gauche.
function titleFontSize(title) {
  if (title.length > 20) return 12.5;
  if (title.length > 12) return 14.5;
  return 17;
}

// Le numero/objet de document (ex: "STAGE CHRISTIAN BATTESTI - GONDRAN
// PIERRE") peut etre long et variable. Le bloc droit de l'en-tete dispose
// d'environ 150mm (de x=45mm a x=195mm) avant de recouper le bloc club a
// gauche : on reduit la taille de police tant que ca ne suffit pas plutot
// que de laisser le texte deborder.
function fitNumeroFontSize(text, baseFs, maxWMm) {
  const maxPt = maxWMm * MM;
  let fs = baseFs;
  while (fs > 6.5 && measureTextWidth(text, 'F1', fs) > maxPt) fs -= 0.5;
  return fs;
}

function drawHeader(p, { title, numero, dateLabel }) {
  // Bandeau noir
  p.setFillRgb(NOIR);
  p.rect(0, 0, 210, HEADER_H, 'f');

  // Logo officiel du club, sur plaque blanche arrondie — le logo est en
  // traits noirs et devient quasi invisible directement sur le bandeau noir,
  // d'où la plaque blanche en arrière-plan (cf. club-logo.js, composité sur
  // fond blanc).
  p.setFillRgb(WHITE);
  p.roundedRect(11, 5, 28, 28, 2.5, 'f');
  const logoImg = addJpegImage(p, base64ToBytes(CLUB_LOGO_JPEG_B64));
  if (logoImg) {
    p.drawImageContain(logoImg.id, 13, 7, 24, 24, CLUB_LOGO_WIDTH_PX, CLUB_LOGO_HEIGHT_PX);
  }

  // Identité club
  const leftX = 43;
  p.setFont('F2', 11);
  p.text(CLUB_NOM.toUpperCase(), leftX, 12, { color: WHITE });
  p.setFont('F1', 7.3);
  p.text(CLUB_ADRESSE_L1, leftX, 17, { color: [185, 185, 185] });
  p.text(CLUB_ADRESSE_L2, leftX, 20.8, { color: [185, 185, 185] });
  p.text(`RNA ${RNA} - SIREN ${SIREN}`, leftX, 24.6, { color: [185, 185, 185] });
  p.text(`${CLUB_EMAIL} - ${CLUB_TEL}`, leftX, 28.4, { color: [185, 185, 185] });

  // Titre document (droite)
  const fs = titleFontSize(title);
  p.setFont('F2', fs);
  p.text(title.toUpperCase(), 195, 15, { align: 'right', color: DORE_CLAIR });
  const numeroText = `N° ${numero}`;
  const numeroFs = fitNumeroFontSize(numeroText, 10, 150);
  p.setFont('F1', numeroFs);
  p.text(numeroText, 195, 23, { align: 'right', color: WHITE });
  p.setFont('F1', 8.5);
  p.text(dateLabel, 195, 28.5, { align: 'right', color: [190, 190, 190] });
}

const FOOTER_Y = 277;

function drawFooter(p, { mentionTva, note }) {
  p.setFillRgb(NOIR);
  p.rect(0, FOOTER_Y, 210, 297 - FOOTER_Y, 'f');
  p.setFont('F1', 7.3);
  p.text(
    `${CLUB_NOM} - Association loi 1901 - RNA ${RNA} - SIREN ${SIREN} - SIRET ${SIRET}`,
    105, FOOTER_Y + 6.5, { align: 'center', color: [190, 190, 190] },
  );
  p.text(`${CLUB_ADRESSE_L2} - ${CLUB_EMAIL} - ${CLUB_TEL} - ${CLUB_SITE}`, 105, FOOTER_Y + 10.3, { align: 'center', color: [160, 160, 160] });
  p.text(mentionTva || MENTION_TVA_DEFAUT, 105, FOOTER_Y + 14.1, { align: 'center', color: [150, 150, 150] });
  if (note) p.text(note, 105, FOOTER_Y + 17.5, { align: 'center', color: [120, 120, 120] });
}

function drawPartiesBlock(p, { emetteur, destinataire, yStart = 51 }) {
  const colL = 15, colR = 110;

  p.setFont('F2', 7.5);
  p.text('EMETTEUR', colL, yStart, { color: DORE });
  p.text('DESTINATAIRE', colR, yStart, { color: DORE });

  p.setFont('F2', 10.5);
  p.text(emetteur.nom || CLUB_NOM, colL, yStart + 6, { color: INK });
  p.text(destinataire.nom || '', colR, yStart + 6, { color: INK });

  p.setFont('F1', 8.7);
  const eLines = emetteur.lignes || [];
  const dLines = destinataire.lignes || [];
  eLines.forEach((l, i) => p.text(l, colL, yStart + 11 + i * 4.3, { color: MUTED }));
  dLines.forEach((l, i) => p.text(l, colR, yStart + 11 + i * 4.3, { color: MUTED }));

  return yStart + 11 + Math.max(eLines.length, dLines.length) * 4.3 + 4;
}

// Petit helper de mise en lignes (identique a PdfBuilder.textWrapped, mais
// sans dessiner tout de suite : on doit connaitre le nombre de lignes AVANT
// de dessiner le cadre de fond, pour dimensionner sa hauteur).
function wrapLines(text, fontName, fontSize, maxWMm) {
  const maxPt = maxWMm * MM;
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (measureTextWidth(candidate, fontName, fontSize) <= maxPt) { cur = candidate; continue; }
    if (cur) lines.push(cur);
    cur = w;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawObjet(p, objet, y) {
  if (!objet) return y;
  const fs = 9;
  const lineH = 4.6;
  // La ligne "Objet" concatene parfois plusieurs infos (numero de commande,
  // statut, note client...) et pouvait deborder largement au-dela du bord
  // de page faute de retour a la ligne (jusqu'a ~20mm de trop constate en
  // test). On calcule maintenant le nombre de lignes necessaires avant de
  // dessiner le cadre, pour que le cadre grandisse avec le texte au lieu
  // que le texte deborde du cadre.
  const lines = wrapLines(`Objet : ${objet}`, 'F3', fs, 170);
  const h = Math.max(9, lines.length * lineH + 4);
  p.setFillRgb([248, 246, 240]);
  p.rect(15, y, 180, h, 'f');
  p.setFillRgb(DORE_CLAIR);
  p.rect(15, y, 1, h, 'f');
  p.setFont('F3', fs);
  const ty = y + (h - (lines.length - 1) * lineH) / 2 + 1.5;
  lines.forEach((l, i) => p.text(l, 20, ty + i * lineH, { color: INK }));
  return y + h + 6;
}

// Ancre commune de la colonne "montants" : le tableau des lignes aligne deja
// ses valeurs a 193mm (2mm de retrait par rapport au filet a 195mm) — le
// sous-total et le total final doivent utiliser la meme ancre pour rester
// visuellement alignes en colonne, au lieu de 3 positions differentes.
const AMOUNT_X = 193;

// Table de lignes (désignation / qté / pu / total). `lignes` = [{designation, qte, pu, total}]
function drawLignesTable(p, lignes, yStart) {
  let y = yStart;
  const rowH = 7.2;

  p.setFillRgb(NOIR);
  p.rect(15, y, 180, 8, 'f');
  p.setFont('F2', 8);
  p.text('DESIGNATION', 18, y + 5.3, { color: WHITE });
  p.text('QTE', 138, y + 5.3, { color: WHITE, align: 'right' });
  p.text('P.U.', 165, y + 5.3, { color: WHITE, align: 'right' });
  p.text('TOTAL', AMOUNT_X, y + 5.3, { color: WHITE, align: 'right' });
  y += 8;

  lignes.forEach((l, i) => {
    const nameLines = wrapLines(l.designation, 'F1', 9, 116);
    const rh = Math.max(rowH, nameLines.length * 4.2 + 3);
    if (i % 2 === 1) { p.setFillRgb(ROW_ALT); p.rect(15, y, 180, rh, 'f'); }
    p.setFont('F1', 9);
    nameLines.forEach((nl, li) => p.text(nl, 18, y + 4.2 * (li + 1), { color: INK }));
    if (l.qte != null) p.text(String(l.qte), 138, y + rh / 2 + 1.6, { color: MUTED, align: 'right' });
    if (l.pu != null) p.text(eur(l.pu), 165, y + rh / 2 + 1.6, { color: MUTED, align: 'right' });
    p.setFont('F2', 9);
    p.text(eur(l.total), AMOUNT_X, y + rh / 2 + 1.6, { color: INK, align: 'right' });
    y += rh;
  });

  p.setStrokeRgb(LINE);
  p.setLineWidth(0.3);
  p.line(15, y, 195, y);
  return y + 6;
}

function drawTotaux(p, { sousTotal, total, tvaLabel }, y) {
  const boxX = 120, boxW = 75;
  if (sousTotal != null) {
    p.setFont('F1', 9);
    p.text('Sous-total', boxX, y, { color: MUTED });
    p.text(eur(sousTotal), AMOUNT_X, y, { color: INK, align: 'right' });
    y += 5.5;
  }
  p.setFont('F1', 8);
  p.text(tvaLabel || 'TVA non applicable', boxX, y, { color: MUTED });
  y += 6;

  p.setFillRgb(NOIR);
  p.roundedRect(boxX, y, boxW, 11, 1.5, 'f');
  p.setFont('F2', 10.5);
  p.text('TOTAL', boxX + 5, y + 7.2, { color: WHITE });
  p.setFont('F2', 13);
  p.text(eur(total), AMOUNT_X, y + 7.4, { color: DORE_CLAIR, align: 'right' });
  return y + 11 + 8;
}

// Bloc spécifique reçu de don : montant + montant déductible (66%)
function drawDonBlock(p, { montant }, y) {
  const boxX = 15, boxW = 180;
  p.setFillRgb([248, 246, 240]);
  p.rect(boxX, y, boxW, 22, 'f');
  p.setFont('F1', 9);
  p.text('Montant du don', boxX + 6, y + 8, { color: MUTED });
  p.setFont('F2', 13);
  p.text(eur(montant), boxX + boxW - 6, y + 8.5, { color: INK, align: 'right' });

  p.setFillRgb(DORE_BG);
  p.rect(boxX + 4, y + 12, boxW - 8, 8, 'f');
  p.setFont('F1', 8.5);
  p.text('Montant deductible de l\'impot sur le revenu (66%, art. 200 CGI)', boxX + 8, y + 17.2, { color: INK });
  p.setFont('F2', 10);
  p.text(eur(montant * 0.66), boxX + boxW - 8, y + 17.4, { color: DORE, align: 'right' });

  return y + 22 + 8;
}

// Paragraphes libres (attestation)
function drawParagraphs(p, paragraphs, y) {
  p.setFont('F1', 10);
  for (const para of paragraphs) {
    const lines = p.textWrapped(para, 15, y, 180, { fontName: 'F1', fontSize: 10, color: INK });
    y += lines * 5.4 + 4;
  }
  return y;
}

/**
 * Construit un document PDF harmonisé.
 *
 * @param {object} doc
 * @param {'facture'|'don'|'cotisation'|'attestation'} doc.type
 * @param {string} doc.numero
 * @param {string} doc.dateLabel     Ex: "Emis le 17/07/2026"
 * @param {{nom:string, lignes:string[]}} [doc.emetteur]  Défaut = club
 * @param {{nom:string, lignes:string[]}} doc.destinataire
 * @param {string} [doc.objet]
 * @param {{designation:string, qte?:number, pu?:number, total:number}[]} [doc.lignes]
 * @param {number} [doc.sousTotal]
 * @param {number} [doc.total]
 * @param {number} [doc.montantDon]   Pour type='don'
 * @param {string[]} [doc.paragraphs] Pour type='attestation'
 * @param {string} [doc.tvaLabel]
 * @param {string} [doc.mentionTva]
 * @param {string} [doc.footerNote]
 * @returns {Uint8Array}
 */
export function buildDocumentPdfBytes(doc) {
  const p = new PdfBuilder();
  const titres = {
    facture: 'Facture',
    don: 'Recu de don',
    cotisation: 'Recu de cotisation',
    attestation: 'Attestation de cotisation',
  };

  drawHeader(p, { title: titres[doc.type] || 'Document', numero: doc.numero, dateLabel: doc.dateLabel });

  const emetteur = doc.emetteur || {
    nom: CLUB_NOM,
    lignes: [CLUB_ADRESSE_L1, CLUB_ADRESSE_L2, `RNA ${RNA} - SIREN ${SIREN}`, CLUB_EMAIL],
  };
  let y = drawPartiesBlock(p, { emetteur, destinataire: doc.destinataire || { nom: '', lignes: [] } });
  y = drawObjet(p, doc.objet, y);

  if (doc.type === 'attestation') {
    y = drawParagraphs(p, doc.paragraphs || [], y + 4);
    y += 10;
    p.setFont('F3', 10);
    p.text(`Fait a Bons-en-Chablais, le ${doc.dateCourte || ''}`, 130, y, { color: INK });
    p.setFont('F1', 9);
    p.text('Le secretaire,', 130, y + 12, { color: MUTED });
    p.setFont('F2', 10);
    p.text(doc.signataire || 'Teddy', 130, y + 18, { color: INK });
  } else if (doc.type === 'don') {
    y = drawDonBlock(p, { montant: doc.montantDon }, y);
  } else {
    y = drawLignesTable(p, doc.lignes || [], y);
    y = drawTotaux(p, { sousTotal: doc.sousTotal, total: doc.total, tvaLabel: doc.tvaLabel }, y);
  }

  drawFooter(p, { mentionTva: doc.mentionTva, note: doc.footerNote });

  return buildPdfDocument(p.getStreams(), p.images);
}
