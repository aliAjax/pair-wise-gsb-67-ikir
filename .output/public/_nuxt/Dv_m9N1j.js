import{s as t}from"./BfZ0PhPX.js";import{a0 as a,o as s,c as n,ag as p,ah as c}from"./BachzCus.js";import{s as r}from"./jc0MLXVe.js";import"./gJHxbORL.js";var i=`
    .p-checkbox-group {
        display: inline-flex;
    }
`,u={root:"p-checkbox-group p-component"},m=a.extend({name:"checkboxgroup",style:i,classes:u}),h={name:"BaseCheckboxGroup",extends:t,style:m,provide:function(){return{$pcCheckboxGroup:this,$parentInstance:this}}},l={name:"CheckboxGroup",extends:h,inheritAttrs:!1,data:function(){return{groupName:this.name}},watch:{name:function(o){this.groupName=o||r("checkbox-group-")}},mounted:function(){this.groupName=this.groupName||r("checkbox-group-")}};function d(e,o,x,f,g,k){return s(),n("div",c({class:e.cx("root")},e.ptmi("root")),[p(e.$slots,"default")],16)}l.render=d;export{l as default};
