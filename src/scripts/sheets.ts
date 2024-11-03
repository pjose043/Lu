import dotenv from 'dotenv';
import { google } from 'googleapis';
import path from 'path';

dotenv.config();

const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1E6kFVz0n8xh3qeUcakbVB3GgoFoaaO0U9mN12AGU9zI';

// Función auxiliar para validar y formatear valores numéricos
const formatValue = (value, isPrice = false) => {
    // Si el valor es null o undefined, retornamos string vacío
    if (value === null || value === undefined) {
        return '';
    }

    // Si es un precio, aseguramos que se maneje como número
    if (isPrice) {
        if (typeof value === 'number') {
            return value;
        }
        if (typeof value === 'string') {
            const cleanValue = value.trim().replace(',', '.');
            const numValue = parseFloat(cleanValue);
            if (!isNaN(numValue)) {
                return numValue;
            }
        }
    }

    // Para valores no numéricos o no precios, retornamos el valor original
    return value;
};

export const readSheet = async (range) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: range
        });
        return response.data.values;
    } catch (error) {
        console.error('Error leyendo la hoja:', error);
        throw error;
    }
};

export const writeToSheet = async (values, range) => {
    try {
        // Determinar qué columna es la columna E (índice 4 en un array 0-based)
        const priceColumnIndex = 4; // Columna E

        // Formatear los valores antes de escribirlos
        const formattedValues = values.map(row => {
            if (!Array.isArray(row)) {
                return [formatValue(row)];
            }
            return row.map((value, index) => 
                formatValue(value, index === priceColumnIndex)
            );
        });

        const request = {
            spreadsheetId: SPREADSHEET_ID,
            range: range,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: formattedValues
            }
        };

        // Realizar la escritura
        const response = await sheets.spreadsheets.values.update(request);

        // Aplicar formato específicamente a la columna E
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                requests: [{
                    repeatCell: {
                        range: {
                            sheetId: 0,
                            startColumnIndex: 4, // Columna E (0-based index)
                            endColumnIndex: 5,
                            startRowIndex: 0,
                            endRowIndex: 1000 // Ajusta según necesites
                        },
                        cell: {
                            userEnteredFormat: {
                                numberFormat: {
                                    type: 'NUMBER',
                                    pattern: '#,##0.00' // Formato con dos decimales
                                }
                            }
                        },
                        fields: 'userEnteredFormat.numberFormat'
                    }
                }]
            }
        });

        return response;
    } catch (error) {
        console.error('Error escribiendo en la hoja:', error);
        throw error;
    }
};

// Función auxiliar para convertir letra de columna a índice
function columnToIndex(column) {
    let index = 0;
    for (let i = 0; i < column.length; i++) {
        index = index * 26 + column.charCodeAt(i) - 'A'.charCodeAt(0) + 1;
    }
    return index - 1;
}

export default {
    readSheet,
    writeToSheet
};