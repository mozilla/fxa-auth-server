FROM node:0.10

WORKDIR /app
COPY . /app

# install deps and remove cached data
RUN npm install && \
    rm -rf  /root/.node-gyp && \
    npm cache clear && \
    apt-get clean
