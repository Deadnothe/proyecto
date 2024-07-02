const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const shortid = require('shortid');
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const multerS3 = require('multer-s3');
const useragent = require('useragent');
const basicAuth = require('express-basic-auth');

const app = express();
const port = process.env.PORT || 3000;

// Configuración de AWS S3
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Configuración de Multer para S3
const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: process.env.AWS_S3_BUCKET,
        key: function (req, file, cb) {
            const uniqueSuffix = shortid.generate();
            const fileExtension = path.extname(file.originalname);
            cb(null, 'videos/' + uniqueSuffix + fileExtension);
        },
        // Opciones para mejorar la velocidad de subida
        transferAcceleration: true, // Habilitar transferencia acelerada en S3
        // Parámetros de configuración de S3 para multipartes
        s3AccelerationOptions: {
            speedThreshold: 20 * 1024 * 1024, // Acelerar si el tamaño del archivo es mayor a 20 MB
            partSize: 10 * 1024 * 1024, // Tamaño de las partes (mínimo 5 MB, máximo 5 GB)
            concurrentParts: 5, // Número máximo de partes concurrentes
        }
    }),
    limits: { fileSize: 2000 * 1024 * 1024 } // Limite de 2GB
});

// Conexión a la base de datos PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Creación de la tabla de videos si no existe
pool.query(`CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    filename TEXT,
    redirectUrl TEXT,
    description TEXT,
    bannerScript1 TEXT,
    bannerScript2 TEXT,
    bannerScript3 TEXT,
    bannerScript4 TEXT,
    bannerScript5 TEXT,
    facebookRedirectUrl TEXT,
    useCloaking BOOLEAN,
    useAntibot BOOLEAN,
    usePreview BOOLEAN,
    useVisitCounter BOOLEAN,
    previewTitle TEXT,
    previewImage TEXT,
    visitCounterScript TEXT,
    clickCount INTEGER DEFAULT 0
)`);

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Autenticación básica para el panel de administración
app.use('/admin', basicAuth({
    users: { 'Josejagl': 'Jose2211$' },
    challenge: true,
}));

// Función para determinar si el usuario es un bot
function isBot(userAgent) {
    const botList = [
        'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider', 'yandexbot', 'sogou', 'exabot', 'facebookexternalhit'
    ];
    return botList.some(bot => userAgent.toLowerCase().includes(bot));
}

// Función para determinar si es un bot de Facebook
function isFacebookBot(userAgent) {
    return userAgent.toLowerCase().includes('facebookexternalhit');
}

// Ruta para subir un video
app.post('/upload', upload.single('video'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No se recibió ningún archivo de video' });
    }

    const videoId = shortid.generate();
    const filename = req.file.key;
    const {
        redirectUrl,
        description,
        bannerScript1,
        bannerScript2,
        bannerScript3,
        bannerScript4,
        bannerScript5,
        facebookRedirectUrl,
        useCloaking,
        useAntibot,
        usePreview,
        useVisitCounter,
        previewTitle,
        previewImage,
        visitCounterScript
    } = req.body;

    try {
        await pool.query(`INSERT INTO videos (
            id, filename, redirectUrl, description, bannerScript1, bannerScript2, bannerScript3, bannerScript4, bannerScript5,
            facebookRedirectUrl, useCloaking, useAntibot, usePreview, useVisitCounter, previewTitle, previewImage, visitCounterScript, clickCount
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
            videoId, filename, redirectUrl, description, bannerScript1, bannerScript2, bannerScript3, bannerScript4, bannerScript5,
            facebookRedirectUrl, useCloaking === 'on', useAntibot === 'on', usePreview === 'on', useVisitCounter === 'on',
            previewTitle, previewImage, visitCounterScript, 0
        ]);
        res.json({ success: true, url: `/video/${videoId}` });
    } catch (err) {
        console.error('Error al insertar el video en la base de datos:', err);
        return res.status(500).json({ success: false, message: 'Error al guardar en la base de datos' });
    }
});

// Ruta para obtener un video por su ID
app.get('/video/:id', async (req, res) => {
    const videoId = req.params.id;

    try {
        const result = await pool.query(`SELECT * FROM videos WHERE id = $1`, [videoId]);
        const video = result.rows[0];

        if (!video) {
            return res.status(404).send('Video no encontrado');
        }

        const userAgent = useragent.parse(req.headers['user-agent']).toString();

        // Implementar lógica de antibot
        if (video.useAntibot && isBot(userAgent)) {
            return res.status(403).send('Acceso denegado');
        }

        // Redirigir bots de Facebook a una URL específica
        if (video.facebookRedirectUrl && isFacebookBot(userAgent)) {
            return res.redirect(video.facebookRedirectUrl);
        }

        // Incrementar contador de clics si hay una URL de redirección
        if (video.redirectUrl) {
            await pool.query(`UPDATE videos SET clickCount = clickCount + 1 WHERE id = $1`, [videoId]);
            return res.redirect(video.redirectUrl);
        }

        // Si no hay redirección, mostrar la página del video
        const videoUrl = `https://${process.env.AWS_S3_BUCKET}.s3.amazonaws.com/${video.filename}`;

        // Consulta para obtener videos relacionados aleatorios
        const relatedVideosResult = await pool.query(`
            SELECT id, description, previewimage FROM videos
            WHERE id != $1
            ORDER BY RANDOM()
            LIMIT 4
        `, [videoId]);
        const relatedVideos = relatedVideosResult.rows;

        // Renderizar la página del video con videos relacionados y banners
        res.send(`
    <!DOCTYPE html>
    <html lang="en">
    ${video.visitcounterscript || ''}
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Video</title>
        <meta property="og:title" content="${video.previewtitle || 'Video'}">
        <meta property="og:image" content="${video.previewimage || ''}">
        <meta property="og:description" content="Visualiza el video">
        <style>
            body {
                text-align: center;
                background-color: #f0f8ff;
                color: #333;
                padding: 20px;
                margin: 0;
            }
            video {
                width: 100%;
                max-width: 800px;
                margin: 20px 0;
            }
            .banner {
                margin: 10px 0;
            }
            .related-videos {
                display: flex;
                justify-content: space-between;
                margin: 20px 0;
            }
            .related-video {
                width: 45%;
                max-width: 150px;
                margin: 10px;
            }
            .related-video img {
                width: 100%;
                cursor: pointer;
            }
            @media (max-width: 600px) {
                video {
                    width: 100%;
                }
                .banner {
                    width: 100%;
                    display: inline-block;
                }
                .related-videos {
                    flex-direction: column;
                    align-items: center;
                }
                .related-video {
                    width: 100%;
                    max-width: none;
                    margin: 5px 0;
                }
            }
        </style>
    </head>
    <body>
        <div class="banner">${video.bannerscript1 || ''}</div>
        <div class="banner">${video.bannerscript2 || ''}</div>
        <div class="banner">${video.bannerscript3 || ''}</div>
        <div>${video.description}</div>
        <video controls id="videoPlayer">
            <source src="${videoUrl}" type="video/mp4">
            Tu navegador no soporta el elemento de video.
        </video>
        <h1>Sugerencias de Videos</h1>
        <div class="related-videos">
            ${relatedVideos.slice(0, 2).map(rv => `
                <div class="related-video">
                    <a href="/video/${rv.id}">
                        <img src="${rv.previewimage}" alt="Video relacionado">
                    </a>
                    <p>${rv.description}</p>
                </div>
            `).join('')}
        </div>
        <div class="related-videos">
            ${relatedVideos.slice(2, 4).map(rv => `
                <div class="related-video">
                    <a href="/video/${rv.id}">
                        <img src="${rv.previewimage}" alt="Video relacionado">
                    </a>
                    <p>${rv.description}</p>
                </div>
            `).join('')}
        </div>
        <div class="banner">${video.bannerscript4 || ''}</div>
        <div class="banner">${video.bannerscript5 || ''}</div>
        <script>
            document.getElementById('videoPlayer').addEventListener('play', function() {
            });
        </script>
    </body>
    </html>
`);

    } catch (err) {
        console.error('Error al obtener el video de la base de datos:', err);
        return res.status(500).send('Error interno del servidor');
    }
});



// Ruta para obtener todos los videos públicos
app.get('/videos', async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, filename, description, previewImage FROM videos`);
        const videos = result.rows;

        res.send(`
            <!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SexXHub Videos</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background: no-repeat center center fixed;
            background-size: cover;
            display: flex;
            flex-direction: column;
            align-items: center;
            color: #fff;
        }

        h1 {
            font-size: 3rem;
            text-align: center;
            color: #ff69b4;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
            letter-spacing: 2px;
            margin-top: 20px;
        }

        .video-container {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            padding: 20px;
            width: 90%;
            max-width: 1200px;
        }

        .video-item {
            background-color: rgba(0, 0, 0, 0.7);
            padding: 10px;
            border-radius: 10px;
            box-shadow: 0 0 15px rgba(0, 0, 0, 0.5);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }

        .video-item img {
            width: 100%;
            height: auto;
            border-radius: 5px;
        }

        .video-item p {
            margin-top: 10px;
            font-size: 1rem;
            text-align: center;
        }

        .video-item:hover {
            transform: translateY(-5px);
            box-shadow: 0 0 20px rgba(255, 105, 180, 0.8);
        }
    </style>
    <script>
        window.onload = function() {
            const gifs = [
                'https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhrdklFCim48unSIlZnvzx0b38P_JvazkOMNwLb0p-5j_7lKgLvRu86OTpOQAVUAqcaEDXo_0gMKHX3VH0brYhF74lsOT1HzgM9va7Hvq8l-kMdxxYK7X7Y7BEJ4uDcUm5uBswHWLzyihvqcNDWP2fBQt6f-HRg1mf_fId9djj4ssBzgyzQKktit9esvcA/s320/git%20portada%20%C2%B418.gif',
                'https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEjR6iKXHsulBjHPwGFSvBUUBbhkTn147WKhb8ORhrDu3z0y3exUvgpWsP9C5kocrbtTqukBEL5zt8jpHlvTw98mkuIG0L90bONvHw08R5DId0Q3MN6bhxaCPjCBhM54P7ZgaWr447JKDzozQ5546WrblNIW_sAT4I5pMCs58TsF3R5_-TneDKVMr2sMirg/s320/git%20portada%20+18%202.gif',
                'https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEg-jbFXvGf6J-S6dwfLfq5E72ilmUgTjJJAhPIMRvtZH_S746Jwn5WsVTXvsVYdd7Fr-m8beWCm86x9igM6iXpt-rbtqfkXQ29jjjuvDai2BLoQ_skSWYeH5C0O4MZJEqoXohVG7CndeXK0UWdJQCVDZsjPgIsxS662LiWvewg3x3GkkmemOnR-1dksplI/s320/git%20portada%20+18%203.gif',
                'https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEjnmPcunv_nba1D8_vUQjkx2sc11zswcmUZPRiUH4FAkjTT3TEqAV5T6Rid7WgjWZe2gZTSFL-_MLoegYm9dTt_ZvnmmOzLQr76o_l3ggN17fVu0D1Y-9Ox41WFvJI1-QIGrrXwIVHWs3ai9Y54C7TPLU1U32Gl14S1JEHRroQ9z7ZH2QEXpx1uSWB0YlQ/s320/git%20portada%20+18%204.gif'
            ];
            const selectedGif = gifs[Math.floor(Math.random() * gifs.length)];
            document.body.style.backgroundImage = `url(${selectedGif})`;
        }
    </script>
</head>
<body>
    <h1>SexXHub Videos</h1>
    <div class="video-container">
        ${videos.map(video => `
            <div class="video-item">
                <a href="/video/${video.id}">
                    <img src="${video.previewimage || 'https://placehold.it/300x200'}" alt="${video.description || 'Video'}">
                    <p>${video.description || 'Video'}</p>
                </a>
            </div>
        `).join('')}
    </div>
</body>
</html>


        `);
    } catch (err) {
        console.error('Error al obtener todos los videos de la base de datos:', err);
        return res.status(500).json({ success: false, message: 'Error al obtener videos de la base de datos' });
    }
});

// Panel de administración y gestión de videos
app.get('/admin', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Admin Panel</title>
        </head>
        <body>
            <h1>Panel de Administración</h1>
            <p>Utiliza los siguientes enlaces para administrar los videos:</p>
            <ul>
                <li><a href="/admin/videos">Ver y gestionar videos</a></li>
            </ul>
        </body>
        </html>
    `);
});

app.get('/admin/videos', async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, filename, description FROM videos`);
        const videos = result.rows;

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Administrar Videos</title>
                <style>
                    .video-container {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                        gap: 20px;
                        padding: 20px;
                    }
                    .video-card {
                        border: 1px solid #ddd;
                        padding: 10px;
                        text-align: center;
                        border-radius: 8px;
                        background-color: #f9f9f9;
                    }
                    .video-card img {
                        max-width: 100%;
                        height: auto;
                        border-radius: 4px;
                    }
                </style>
            </head>
            <body>
                <h1>Gestionar Videos</h1>
                <div class="video-container">
                    ${videos.map(video => `
                        <div class="video-card">
                            <p>ID: ${video.id}</p>
                            <p>Descripción: ${video.description}</p>
                            <a href="/admin/videos/${video.id}/edit">Editar</a> | 
                            <a href="/admin/videos/${video.id}/delete" onclick="return confirm('¿Estás seguro de que deseas eliminar este video?')">Eliminar</a>
                        </div>
                    `).join('')}
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        console.error('Error al obtener la lista de videos para administrar:', err);
        res.status(500).send('Error al obtener la lista de videos para administrar');
    }
});

app.get('/admin/videos/:id/edit', async (req, res) => {
    const videoId = req.params.id;

    try {
        const result = await pool.query(`SELECT * FROM videos WHERE id = $1`, [videoId]);
        const video = result.rows[0];

        if (!video) {
            return res.status(404).send('Video no encontrado');
        }

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Editar Video</title>
            </head>
            <body>
                <h1>Editar Video</h1>
                <form action="/admin/videos/${videoId}/edit" method="post">
                    <label for="description">Descripción:</label>
                    <input type="text" id="description" name="description" value="${video.description}"><br><br>
                    <button type="submit">Guardar Cambios</button>
                </form>
            </body>
            </html>
        `);
    } catch (err) {
        console.error('Error al obtener el video para editar:', err);
        res.status(500).send('Error al obtener el video para editar');
    }
});

app.post('/admin/videos/:id/edit', async (req, res) => {
    const videoId = req.params.id;
    const { description } = req.body;

    try {
        await pool.query(`UPDATE videos SET description = $1 WHERE id = $2`, [description, videoId]);
        res.redirect('/admin/videos');
    } catch (err) {
        console.error('Error al actualizar el video:', err);
        res.status(500).send('Error al actualizar el video');
    }
});

app.get('/admin/videos/:id/delete', async (req, res) => {
    const videoId = req.params.id;

    try {
        const result = await pool.query(`DELETE FROM videos WHERE id = $1 RETURNING filename`, [videoId]);
        const video = result.rows[0];

        if (!video) {
            return res.status(404).send('Video no encontrado');
        }

        const params = {
            Bucket: process.env.AWS_S3_BUCKET,
            Key: video.filename
        };

        await s3.deleteObject(params).promise();
        res.redirect('/admin/videos');
    } catch (err) {
        console.error('Error al eliminar el video:', err);
        res.status(500).send('Error al eliminar el video');
    }
});

app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
});
