import path, { join } from 'path'
import { createBot, createProvider, createFlow,addKeyword, utils,EVENTS} from '@builderbot/bot'

import { MemoryDB as Database } from '@builderbot/bot'
import { BaileysProvider as Provider } from '@builderbot/provider-baileys'

const PORT = process.env.PORT ?? 3009


import { writeToSheet, readSheet } from './scripts/sheets'

import { products } from './flow/products.flow'

import { chat } from './scripts/geminiService'

// Flujo continuar comprando
const flowContinue = addKeyword(['1', 'continuar'])
    .addAnswer(['Perfecto, ¿qué tipo de producto te interesa? Selecciona una categoría:\n\n',
        '1️⃣ Ropa de hombre\n',
        '2️⃣ Ropa de mujer\n',
        '3️⃣ Regresar al Menu principal'],
        { capture: true },
        async (ctx, { gotoFlow }) => {
            const response = ctx.body;
            if (response === '1' || response === '2') {
                return gotoFlow(flowCategories);
            } else if (response === '3') {
                return gotoFlow(flowPrincipal);
            }
        }
    );

const flowSize = addKeyword(['xl', 'l', 'm', 's', '1', '2', '3', '4'])
    .addAction(async (ctx, { flowDynamic, state, endFlow }) => {
        // Verificar si viene del flujo correcto
        const currentState = state.getMyState();
        if (!currentState?.selectedGender) {
            return endFlow(); // Terminar el flujo si no viene del flujo correcto
        }
    })
    .addAnswer('🛍️ *Productos disponibles:*')
    .addAction(async (ctx, { flowDynamic, state }) => {
        const currentState = state.getMyState();
        const gender = currentState?.selectedGender;

        const categoryProducts = gender === 'Mujer' ? products.women : products.men;

        for (const [key, product] of Object.entries(categoryProducts)) {
            await flowDynamic([
                {
                    body: `${key}️⃣ ${product.name} - S/${product.price}`,
                    media: product.image
                }
            ]);
        }
    })
    .addAnswer(
        [],
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow, state }) => {
            const productId = ctx.body;
            const currentState = state.getMyState();
            const gender = currentState?.selectedGender;

            const categoryProducts = gender === 'Mujer' ? products.women : products.men;

            if (productId >= '1' && productId <= '3') {
                const product = categoryProducts[productId];
                const currentData = orderData.get(ctx.from);

                if (!product) {
                    await flowDynamic([{
                        body: '❌ Producto no encontrado. Por favor, selecciona un producto válido.'
                    }]);
                    return;
                }

                // Actualizar datos del producto
                currentData.product = product.name;
                currentData.price = product.price;
                orderData.set(ctx.from, currentData);

                // Preparar datos para Google Sheets
                const rowData = [
                    currentData.phoneNumber,
                    currentData.gender,
                    currentData.size,
                    currentData.product,
                    currentData.price,
                    currentData.date
                ];

                try {
                    let nextRow = 2;

                    try {
                        const existingData = await readSheet('Hoja 1!A:F');
                        if (existingData && Array.isArray(existingData)) {
                            nextRow = existingData.length + 1;
                        }
                    } catch (readError) {
                        console.error('Error al leer datos:', readError);
                    }

                    const writeRange = `Hoja 1!A${nextRow}:F${nextRow}`;
                    await writeToSheet([rowData], writeRange);

                    await flowDynamic([{
                        body: `✅ Producto agregado: ${product.name} - S/${product.price}\n\nPedido registrado correctamente.`
                    }]);

                    return gotoFlow(flowAddMore);
                } catch (error) {
                    console.error('Error al procesar el pedido:', error);
                    await flowDynamic([{
                        body: '❌ Lo siento, hubo un error al procesar tu pedido. Por favor, intenta nuevamente.'
                    }]);
                }
            } else if (productId === '4') {
                return gotoFlow(flowPrincipal);
            }
        }
    );

// Función auxiliar simplificada para agregar pedidos
const addOrderToSheet = async (orderData) => {
    try {
        // Leer datos existentes
        const existingData = await readSheet('Hoja 1!A:F');
        const nextRow = existingData && Array.isArray(existingData) ? existingData.length + 1 : 2;

        // Escribir nuevos datos
        const writeRange = `Hoja 1!A${nextRow}:F${nextRow}`;
        await writeToSheet([orderData], writeRange);

        return true;
    } catch (error) {
        console.error('Error al añadir orden:', error);
        return false;
    }
};

// Nuevo flujo para preguntar si desea agregar más prendas
const flowAddMore = addKeyword(['FLOW_ADD_MORE'])
    .addAnswer(['¿Deseas agregar otra prenda?\n\n',
        '1️⃣ Sí, continuar agregando\n',
        '2️⃣ No, finalizar compra'],
        { capture: true },
        async (ctx, { gotoFlow }) => {
            const option = ctx.body;
            if (option === '1') {
                return gotoFlow(flowContinue);
            } else if (option === '2') {

                return gotoFlow(flowGracias);
            }
        }
    );
// Primero, modifiquemos la estructura para almacenar temporalmente los datos del pedido
const orderData = new Map();

// Modificar flowCategories para guardar el género correctamente
const flowCategories = addKeyword(['1', '2', 'hombre', 'mujer'])
    .addAnswer(['Selecciona una talla:\n\n',
        '1️⃣ XL\n',
        '2️⃣ L\n',
        '3️⃣ M\n',
        '4️⃣ S\n',
        '5️⃣ Regresar'],
        { capture: true },
        async (ctx, { gotoFlow, state }) => {
            // Obtener el género del estado anterior
            const previousState = state.getMyState();
            const gender = previousState?.selectedGender || (ctx.body === '1' ? 'Hombre' : 'Mujer');

            console.log('Estado anterior:', previousState);
            console.log('Género seleccionado:', gender);

            // Inicializar o actualizar datos del pedido
            if (!orderData.has(ctx.from)) {
                orderData.set(ctx.from, {
                    gender: gender,
                    phoneNumber: ctx.from,
                    size: '',
                    product: '',
                    price: 0,
                    date: new Date().toLocaleString()
                });
            } else {
                const currentData = orderData.get(ctx.from);
                currentData.gender = gender;
                orderData.set(ctx.from, currentData);
            }

            const size = ctx.body;
            if (size >= '1' && size <= '4') {
                // Convertir número a talla
                const sizeMap = {
                    '1': 'XL',
                    '2': 'L',
                    '3': 'M',
                    '4': 'S'
                };
                const currentData = orderData.get(ctx.from);
                currentData.size = sizeMap[size];
                orderData.set(ctx.from, currentData);

                // Imprimir datos actuales para debugging
                console.log('Datos actuales del pedido:', currentData);

                return gotoFlow(flowSize);
            } else if (size === '5') {
                return gotoFlow(flowPrincipal);
            }
        }
    );

// Modificar flowProducts para guardar el género inicial
const flowProducts = addKeyword(['1', 'productos', 'ver productos'])
    .addAnswer(['Perfecto, ¿qué tipo de producto te interesa? Selecciona una categoría:\n\n',
        '1️⃣ Ropa de hombre\n',
        '2️⃣ Ropa de mujer\n',
        '3️⃣ Regresar al Menu principal'],
        { capture: true },
        async (ctx, { gotoFlow, state }) => {
            const response = ctx.body;
            if (response === '1' || response === '2') {
                // Guardar el género seleccionado en el estado
                const selectedGender = response === '1' ? 'Hombre' : 'Mujer';
                await state.update({ selectedGender });

                console.log('Género guardado en el estado:', selectedGender);

                return gotoFlow(flowCategories);
            } else if (response === '3') {
                return gotoFlow(flowPrincipal);
            }
        }
    );

const flowShipping = addKeyword(['2', 'envios', 'información envíos'])
    .addAnswer('Información de envíos:\n' +
        '- Envío gratis en compras mayores a $50\n' +
        '- Tiempo estimado: 3-5 días hábiles\n' +
        '\n1️⃣ Volver al menú principal',
        { capture: true },
        (ctx, { gotoFlow }) => {
            return gotoFlow(flowPrincipal);
        }
    );

const flowAvailability = addKeyword(['3', 'disponibilidad'])
    .addAnswer('Por favor, indica el nombre o código del producto que deseas consultar.',
        { capture: true },
        async (ctx, { flowDynamic }) => {
            await flowDynamic([{
                body: 'El producto está disponible en todas las tallas. ¿Deseas realizar una compra?'
            }]);
        }
    );

// Modificar flowGracias para limpiar los datos almacenados
const flowGracias = addKeyword(['2'])
    .addAnswer('¡Gracias por tu compra! Tu pedido está en camino. Recibirás un número de seguimiento pronto.',
        null,
        (ctx) => {
            // Limpiar datos del pedido
            orderData.delete(ctx.from);
        }
    );

//
const flowAsesor = addKeyword(['4', 'asesor', 'consulta'])
    .addAnswer(
        'Por favor, escribe tu consulta.',
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            try {
                const response = await chat(ctx.body);
                await flowDynamic(response.text());
                return gotoFlow(flowContinueConsulta);
            } catch (error) {
                console.error('Error en flowAsesor:', error);
                await flowDynamic('❌ Ocurrió un error. Por favor, intenta de nuevo.');
                return gotoFlow(flowPrincipal);
            }
        }
    );

const flowContinueConsulta = addKeyword(EVENTS.ACTION)
    .addAnswer(
        [
         'Escribe *Consulta* para continuar con un *asesor*.'
        ],
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            const response = ctx.body.toLowerCase();
            
            if (response.includes('1') || 
                response.includes('si') || 
                response.includes('sí')) {
                return gotoFlow(flowNuevaConsulta);
            } else {
                await flowDynamic([
                    '👋 ¡Gracias por usar nuestro servicio!',
                    'Si necesitas ayuda más adelante, escribe "menu" para volver al menú principal.'
                ]);
                return gotoFlow(flowPrincipal);
            }
        }
    );

const flowNuevaConsulta = addKeyword(EVENTS.ACTION)
    .addAnswer(
        '¿Cuál es tu nueva consulta? Estaré encantado de ayudarte.',
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            try {
                const response = await chat(ctx.body);
                await flowDynamic(response.text());
                return gotoFlow(flowContinueConsulta);
            } catch (error) {
                console.error('Error en flowNuevaConsulta:', error);
                await flowDynamic('❌ Ocurrió un error. Por favor, intenta de nuevo.');
                return gotoFlow(flowPrincipal);
            }
        }
    );


    const flowPrincipal = addKeyword(['hola', 'menu', 'inicio', EVENTS.WELCOME])
    .addAnswer([
        '🎉¡Bienvenid@ a Lucemas! 🎉\n' +
        '😄Nos alegra tenerte aquí y estamos listos para ofrecerte la mejor ropa para cada ocasión. 👗✨\n' +
        'Este es nuestro *Menú Principal*: 📋\n',
        '1️⃣ Ver productos\n',
        '2️⃣ Información sobre envíos\n',
        '3️⃣ Consultar disponibilidad de un producto\n',
        '4️⃣ Hablar con un asesor'
    ],
    { capture: true },
    async (ctx, { gotoFlow }) => {
        const option = ctx.body;
        
        switch (option) {
            case '1':
                return gotoFlow(flowProducts);
            case '2':
                return gotoFlow(flowShipping);
            case '3':
                return gotoFlow(flowAvailability);
            case '4':
                return gotoFlow(flowAsesor);
            default:
                // Si no es una opción válida, mostrar el menú nuevamente
                return gotoFlow(flowPrincipal);
        }
    });

// También necesitamos agregar un flujo para capturar mensajes que no coincidan con ningún keyword
const flowCatchAll = addKeyword(EVENTS.ACTION)
    .addAction(async (ctx, { gotoFlow }) => {
        return gotoFlow(flowPrincipal);
    });

const main = async () => {
    const adapterFlow = createFlow([
        flowPrincipal,
        flowCatchAll,
        flowAsesor,
        flowProducts,
        flowAddMore,
        flowGracias,
        flowCategories,
        flowSize,
        flowContinue,
        flowShipping,
        flowAvailability

    ])

    const adapterProvider = createProvider(Provider)
    const adapterDB = new Database()

    const { handleCtx, httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })


    adapterProvider.server.post(
        '/v1/messages',
        handleCtx(async (bot, req, res) => {
            const { number, message, urlMedia } = req.body
            await bot.sendMessage(number, message, { media: urlMedia ?? null })
            return res.end('sended')
        })
    )

    adapterProvider.server.post(
        '/v1/register',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body
            await bot.dispatch('REGISTER_FLOW', { from: number, name })
            return res.end('trigger')
        })
    )

    adapterProvider.server.post(
        '/v1/samples',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body
            await bot.dispatch('SAMPLES', { from: number, name })
            return res.end('trigger')
        })
    )

    adapterProvider.server.post(
        '/v1/blacklist',
        handleCtx(async (bot, req, res) => {
            const { number, intent } = req.body
            if (intent === 'remove') bot.blacklist.remove(number)
            if (intent === 'add') bot.blacklist.add(number)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ status: 'ok', number, intent }))
        })
    )

    httpServer(+PORT)
}

main()
