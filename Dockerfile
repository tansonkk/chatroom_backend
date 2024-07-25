FROM node:16

WORKDIR /Users/tatsanchan/Documents/project/chatApp

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm" , "run", "dev"]