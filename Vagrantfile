# -*- mode: ruby -*-
# vi: set ft=ruby :

VAGRANTFILE_API_VERSION = "2"

Vagrant.configure(VAGRANTFILE_API_VERSION) do |config|
  config.vm.box = "precise64"
  config.vm.box_url = "http://files.vagrantup.com/precise64.box"
  config.vm.synced_folder ".",
                          "/vagrant",
                          type: "rsync",
                          rsync__exclude: ["sandbox", "node_modules"]
  #config.vm.network :forwarded_port, guest: 9000, host: 9000, auto_correct: true
  config.ssh.forward_agent = true
  config.vm.provider "virtualbox" do |v|
    v.memory = 2048
    v.customize ["modifyvm", :id, "--cpus", "2"]
  end
  config.vm.provider "vmware_fusion" do |v|
    v.vmx["memsize"] = "2048"
    v.vmx["numvcpus"] = "2"
  end
  script =
    "wget -q http://nodejs.org/dist/v0.10.26/node-v0.10.26-linux-x64.tar.gz;" \
    "tar --strip-components 1 -C /usr/local -xzf node-v0.10.26-linux-x64.tar.gz;" \
    "apt-get -qq update;" \
    "export DEBIAN_FRONTEND=noninteractive;" \
    "apt-get -qq install curl mysql-server-5.5 libgmp-dev git build-essential python-dev python-pip libevent-dev tmux htop;" \
    "pip install virtualenv;"
  config.vm.provision "shell", inline: script
end
