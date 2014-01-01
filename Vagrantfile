# -*- mode: ruby -*-
# vi: set ft=ruby :

VAGRANTFILE_API_VERSION = "2"

Vagrant.configure(VAGRANTFILE_API_VERSION) do |config|
  config.vm.box_url = "vm/sl64_virtualbox.box"
  config.vm.box = "sl64"
  config.vm.network :forwarded_port, guest: 9000, host: 9009, auto_correct: true
  config.ssh.forward_agent = true

  config.vm.provider "virtualbox" do |v|
    v.memory = 2048
  end

  config.vm.provider "vmware_fusion" do |v, override|
    #v.gui = true
    override.vm.box_url = "vm/sl64_vmware.box"
    v.vmx["memsize"] = "2048"
    v.vmx["numvcpus"] = "2"
  end
end
