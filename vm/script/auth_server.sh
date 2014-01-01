#!/bin/bash -eux

# Install stuff
yum -y install sudo openssh-clients make automake git gcc gcc-c++ kernel-devel mysql-server gmp-devel wget

# Install node
wget -q http://nodejs.org/dist/v0.10.23/node-v0.10.23-linux-x64.tar.gz
tar --strip-components 1 -C /usr/local -xzf node-v0.10.23-linux-x64.tar.gz
rm node-v0.10.23-linux-x64.tar.gz

# Start MySQL on boot
chkconfig mysqld on
