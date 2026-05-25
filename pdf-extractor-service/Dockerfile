FROM node:20-slim

# Instalar dependencias del sistema: Poppler (pdftotext, pdftoppm, pdftocairo) y Tesseract OCR con español
RUN apt-get update && apt-get install -y \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-spa \
    && rm -rf /var/lib/apt/lists/*

# Crear directorio de trabajo
WORKDIR /app

# Copiar package.json e instalar dependencias
COPY package.json ./
RUN npm install --production

# Copiar código de la aplicación. text-util.js es un módulo helper que el
# server.js importa (verifica utilidad semántica del texto extraído por Poppler
# antes de decidir si activar Tesseract). Es runtime-required.
COPY server.js text-util.js ./

# Exponer puerto
EXPOSE 3000

# Variable de entorno para el puerto (Render lo sobreescribirá)
ENV PORT=3000

# Comando para iniciar
CMD ["node", "server.js"]
